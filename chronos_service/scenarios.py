from __future__ import annotations

from math import ceil
from typing import Any

import numpy as np

QUANTILE_LEVELS = np.asarray([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], dtype=np.float64)


def _standardized_residuals(history_returns_pct: np.ndarray) -> np.ndarray:
    """Create a robust historical innovation pool without using future observations."""
    returns = np.asarray(history_returns_pct, dtype=np.float64)
    if returns.ndim != 1 or len(returns) < 60:
        raise ValueError("At least 60 daily returns are required to construct bootstrap innovations.")

    rolling_std = np.full(len(returns), np.nan, dtype=np.float64)
    for i in range(19, len(returns)):
        window = returns[max(0, i - 19) : i + 1]
        rolling_std[i] = max(float(np.std(window, ddof=1)), 1e-6)

    residuals = returns[19:] / rolling_std[19:]
    residuals = residuals[np.isfinite(residuals)]
    if len(residuals) < 40:
        raise ValueError("Not enough valid standardized historical returns for scenario generation.")
    return residuals


def block_bootstrap_residuals(
    residuals: np.ndarray,
    n_paths: int,
    prediction_length: int,
    block_length: int = 5,
    seed: int = 42,
) -> np.ndarray:
    """Circular moving-block bootstrap preserving short-run dependence and volatility clustering."""
    values = np.asarray(residuals, dtype=np.float64)
    if values.ndim != 1 or len(values) < block_length:
        raise ValueError("Residual pool is too small for the requested block length.")
    if n_paths < 100 or prediction_length < 1 or block_length < 1:
        raise ValueError("Invalid scenario simulation dimensions.")

    rng = np.random.default_rng(seed)
    blocks = ceil(prediction_length / block_length)
    starts = rng.integers(0, len(values), size=(n_paths, blocks))
    offsets = np.arange(block_length, dtype=np.int64)
    indices = (starts[:, :, None] + offsets[None, None, :]) % len(values)
    return values[indices.reshape(n_paths, -1)[:, :prediction_length]]


def simulate_cumulative_returns(
    daily_quantiles_pct: np.ndarray,
    history_returns_pct: np.ndarray,
    n_paths: int = 10000,
    block_length: int = 5,
    seed: int = 42,
) -> np.ndarray:
    """
    Convert Chronos-2 marginal daily quantiles into correlated cumulative-return paths.

    Chronos-2 supplies marginal quantiles, not a joint path distribution. We preserve
    empirical dependence by block-bootstrapping standardized historical innovations,
    map the central 10%-90% to the model's predicted quantiles, and use empirical
    historical tails outside that trained quantile range.
    """
    forecast = np.asarray(daily_quantiles_pct, dtype=np.float64)
    if forecast.ndim != 2 or forecast.shape[1] != len(QUANTILE_LEVELS):
        raise ValueError("Chronos-2 output must have shape (prediction_length, 9 quantiles).")
    if not np.isfinite(forecast).all():
        raise ValueError("Chronos-2 returned non-finite quantile forecasts.")

    forecast = np.maximum.accumulate(forecast, axis=1)
    residuals = _standardized_residuals(history_returns_pct)
    residual_pool = np.sort(residuals)
    sampled_residuals = block_bootstrap_residuals(
        residuals,
        n_paths=n_paths,
        prediction_length=forecast.shape[0],
        block_length=block_length,
        seed=seed,
    )

    # Transform bootstrap residuals to empirical PIT ranks.
    u = (np.searchsorted(residual_pool, sampled_residuals, side="right") - 0.5) / len(residual_pool)
    u = np.clip(u, 1e-4, 1 - 1e-4)

    z10, z90 = np.quantile(residual_pool, [0.1, 0.9])
    denominator = max(float(z90 - z10), 1e-6)
    daily_paths_pct = np.empty_like(sampled_residuals)

    for step in range(forecast.shape[0]):
        q = forecast[step]
        q10 = float(q[0])
        q90 = float(q[-1])
        scale = max((q90 - q10) / denominator, 1e-6)

        central = np.interp(u[:, step], QUANTILE_LEVELS, q)
        low_tail = q10 + (sampled_residuals[:, step] - z10) * scale
        high_tail = q90 + (sampled_residuals[:, step] - z90) * scale

        values = np.where(u[:, step] < 0.1, low_tail, central)
        values = np.where(u[:, step] > 0.9, high_tail, values)
        daily_paths_pct[:, step] = np.clip(values, -80.0, 80.0)

    cumulative_log_returns = np.cumsum(daily_paths_pct / 100.0, axis=1)
    cumulative_simple_returns = np.expm1(np.clip(cumulative_log_returns, -20.0, 20.0)) * 100.0
    return cumulative_simple_returns


def distribution_for_horizon(
    outcomes_pct: np.ndarray,
    horizon_spec: dict[str, Any],
) -> dict[str, Any]:
    """Build the fixed-bin distribution consumed by the existing TypeScript math audit."""
    outcomes = np.asarray(outcomes_pct, dtype=np.float64)
    bins = horizon_spec["bins"]
    if len(bins) != 10:
        raise ValueError("Each forecast horizon must define exactly 10 probability bins.")

    edges = np.asarray([bins[0]["min_pct"]] + [item["max_pct"] for item in bins], dtype=np.float64)
    underflow = float(np.mean(outcomes < edges[0]))
    overflow = float(np.mean(outcomes >= edges[-1]))
    in_range = outcomes[(outcomes >= edges[0]) & (outcomes < edges[-1])]
    counts, _ = np.histogram(in_range, bins=edges)
    probs = counts.astype(np.float64) / max(len(outcomes), 1)

    cdf = underflow
    output_bins = []
    for item, probability in zip(bins, probs, strict=True):
        cdf += float(probability)
        output_bins.append(
            {
                "min_pct": float(item["min_pct"]),
                "max_pct": float(item["max_pct"]),
                "prob": float(probability),
                "cdf": float(cdf),
            }
        )

    quantiles = np.quantile(outcomes, [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])
    lower_tail = outcomes[outcomes <= quantiles[1]]
    expected_shortfall = float(np.mean(lower_tail)) if len(lower_tail) else float(quantiles[1])

    return {
        "label": horizon_spec["label"],
        "trading_days": int(horizon_spec["trading_days"]),
        "bin_width_pct": float(horizon_spec["bin_width_pct"]),
        "underflow_prob": underflow,
        "overflow_prob": overflow,
        "bins": output_bins,
        "summary": {
            "mean_pct": float(np.mean(outcomes)),
            "median_pct": float(quantiles[3]),
            "std_pct": float(np.std(outcomes, ddof=1)),
            "prob_positive": float(np.mean(outcomes > 0)),
            "expected_shortfall_5pct": expected_shortfall,
            "quantiles_pct": {
                "p01": float(quantiles[0]),
                "p05": float(quantiles[1]),
                "p25": float(quantiles[2]),
                "p75": float(quantiles[4]),
                "p95": float(quantiles[5]),
                "p99": float(quantiles[6]),
            },
        },
    }


def build_horizon_distributions(
    cumulative_paths_pct: np.ndarray,
    horizon_specs: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    paths = np.asarray(cumulative_paths_pct, dtype=np.float64)
    results: dict[str, dict[str, Any]] = {}
    for spec in horizon_specs:
        days = int(spec["trading_days"])
        if days < 1 or days > paths.shape[1]:
            raise ValueError(f"Forecast horizon {days} is outside the generated path length.")
        results[str(spec["key"])] = distribution_for_horizon(paths[:, days - 1], spec)
    return results
