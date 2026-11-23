from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from chronos import Chronos2Pipeline

from app import (
    CONTEXT_LENGTH,
    PROFILE_MAP,
    _build_training_frame,
    _calendar_covariates,
    _fetch_histories,
    _future_market_sessions,
    _return_series,
)
from scenarios import QUANTILE_LEVELS, extend_daily_quantiles, simulate_cumulative_returns

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chronos-walk-forward")

HORIZONS = {
    "1d": 1,
    "5d": 5,
    "21d": 21,
    "63d": 63,
    "252d": 252,
}


def _pinball_loss(actual: float, forecast: float, quantile: float) -> float:
    error = actual - forecast
    return float(max(quantile * error, (quantile - 1.0) * error))


def _score_origin(
    actual_returns: np.ndarray,
    simulated_paths: np.ndarray,
) -> dict[str, dict[str, float]]:
    scores: dict[str, dict[str, float]] = {}
    for name, days in HORIZONS.items():
        if days > len(actual_returns) or days > simulated_paths.shape[1]:
            continue
        actual = float(np.sum(actual_returns[:days]))
        outcomes = simulated_paths[:, days - 1]
        quantiles = np.quantile(outcomes, [0.1, 0.5, 0.9])
        prob_positive = float(np.mean(outcomes > 0))
        scores[name] = {
            "actual_return_pct": actual,
            "pinball_q10": _pinball_loss(actual, float(quantiles[0]), 0.1),
            "pinball_q50": _pinball_loss(actual, float(quantiles[1]), 0.5),
            "pinball_q90": _pinball_loss(actual, float(quantiles[2]), 0.9),
            "coverage_80": float(quantiles[0] <= actual <= quantiles[2]),
            "probability_positive": prob_positive,
            "brier_positive": float((prob_positive - float(actual > 0)) ** 2),
            "forecast_q10": float(quantiles[0]),
            "forecast_q50": float(quantiles[1]),
            "forecast_q90": float(quantiles[2]),
        }
    return scores


def run_walk_forward(
    symbol: str,
    origins: int,
    spacing: int,
    device: str,
    simulations: int,
    output_dir: Path,
) -> dict[str, Any]:
    symbol = symbol.strip().upper()
    profile = PROFILE_MAP.get(
        symbol,
        {"underlying": symbol, "leverage": 1, "volatility": "^VIX", "futures": "ES=F"},
    )
    tickers = [
        symbol,
        str(profile["underlying"]),
        "SPY",
        "^VIX",
        "^VXN",
        str(profile["futures"]),
    ]
    histories, fetch_errors = _fetch_histories(tickers)
    if symbol not in histories:
        raise RuntimeError(
            f"Could not download {symbol} history: {fetch_errors.get(symbol, 'no data returned')}"
        )

    target_history = histories[symbol]
    target_history = target_history.loc[target_history.index <= target_history.index[-1]].copy()
    if len(target_history) < 300 + HORIZONS["252d"] + 5:
        raise RuntimeError("At least 557 completed daily observations are required for walk-forward evaluation.")

    max_horizon = HORIZONS["252d"]
    last_origin_position = len(target_history) - max_horizon - 1
    first_origin_position = max(300, last_origin_position - (origins - 1) * spacing)
    origin_positions = list(range(first_origin_position, last_origin_position + 1, spacing))
    if not origin_positions:
        raise RuntimeError("No walk-forward origins could be constructed.")
    if len(origin_positions) > origins:
        origin_positions = origin_positions[-origins:]

    logger.info(
        "Evaluating %s using %s chronological origins, %s-session spacing, model amazon/chronos-2",
        symbol,
        len(origin_positions),
        spacing,
    )
    pipeline = Chronos2Pipeline.from_pretrained("amazon/chronos-2", device_map=device)
    records: list[dict[str, Any]] = []

    for index, cutoff_position in enumerate(origin_positions, start=1):
        cutoff = target_history.index[cutoff_position]
        actual_close_frame = target_history.iloc[cutoff_position + 1 : cutoff_position + 1 + max_horizon]
        if len(actual_close_frame) < max_horizon:
            continue

        historical_frames = {
            ticker: frame.loc[frame.index <= cutoff].copy()
            for ticker, frame in histories.items()
        }
        historical_target = historical_frames[symbol]
        training, covariates, missing = _build_training_frame(
            symbol,
            profile,
            historical_frames,
            historical_target,
        )
        if len(training) < 300:
            logger.warning("Skipping %s; only %s aligned rows", cutoff.date(), len(training))
            continue

        target_values = training["target"].to_numpy(dtype=np.float32)
        past_covariates = {
            name: training[name].to_numpy(dtype=np.float32)
            for name in covariates
        }
        native_horizon = int(getattr(pipeline, "model_prediction_length", 64))
        direct_horizon = min(max_horizon, native_horizon, 64)
        future_sessions = _future_market_sessions(cutoff.date(), direct_horizon)
        future_calendar = _calendar_covariates(future_sessions)
        future_covariates = {
            name: future_calendar[name].to_numpy(dtype=np.float32)
            for name in future_calendar.columns
            if name in past_covariates
        }
        model_input = {
            "target": target_values,
            "past_covariates": past_covariates,
            "future_covariates": future_covariates,
        }

        try:
            quantiles, _mean = pipeline.predict_quantiles(
                inputs=[model_input],
                prediction_length=direct_horizon,
                quantile_levels=QUANTILE_LEVELS.tolist(),
                context_length=min(CONTEXT_LENGTH, len(training)),
                limit_prediction_length=False,
            )
            direct_quantiles = quantiles[0].detach().cpu().numpy()[0]
            daily_quantiles, _extension = extend_daily_quantiles(
                direct_quantiles_pct=direct_quantiles,
                history_returns_pct=target_values[-min(len(target_values), 1260):],
                total_prediction_length=max_horizon,
            )
            paths = simulate_cumulative_returns(
                daily_quantiles_pct=daily_quantiles,
                history_returns_pct=target_values[-min(len(target_values), 1260):],
                n_paths=simulations,
                block_length=5,
                seed=(sum(ord(char) for char in symbol) + cutoff_position * 17) % (2**32 - 1),
            )
            actual_returns = _return_series(
                pd.concat(
                    [
                        historical_target["Close"].tail(1),
                        actual_close_frame["Close"],
                    ]
                )
            ).dropna().to_numpy(dtype=np.float64)
            horizon_scores = _score_origin(actual_returns, paths)
            records.append(
                {
                    "origin": cutoff.date().isoformat(),
                    "history_observations": len(training),
                    "covariates": covariates,
                    "excluded_covariates": missing,
                    "horizons": horizon_scores,
                }
            )
            logger.info("Completed origin %s/%s at %s", index, len(origin_positions), cutoff.date())
        except Exception:
            logger.exception("Forecast failed at origin %s", cutoff.date())

    if not records:
        raise RuntimeError("No walk-forward origins completed successfully.")

    aggregate: dict[str, dict[str, float]] = {}
    for horizon in HORIZONS:
        rows = [item["horizons"][horizon] for item in records if horizon in item["horizons"]]
        if not rows:
            continue
        aggregate[horizon] = {
            "origins": float(len(rows)),
            "pinball_q10": float(np.mean([row["pinball_q10"] for row in rows])),
            "pinball_q50": float(np.mean([row["pinball_q50"] for row in rows])),
            "pinball_q90": float(np.mean([row["pinball_q90"] for row in rows])),
            "coverage_80": float(np.mean([row["coverage_80"] for row in rows])),
            "brier_positive": float(np.mean([row["brier_positive"] for row in rows])),
        }

    report = {
        "model": "amazon/chronos-2",
        "symbol": symbol,
        "generated_at": datetime.now().astimezone().isoformat(),
        "device": device,
        "simulation_paths_per_origin": simulations,
        "origin_spacing_sessions": spacing,
        "origins_completed": len(records),
        "method": "strict chronological expanding-window, no future data in training inputs",
        "aggregate_metrics": aggregate,
        "origins": records,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"chronos2_walk_forward_{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    logger.info("Saved walk-forward report to %s", path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Chronos-2 rolling-origin market forecast validation")
    parser.add_argument("--symbol", default="TQQQ")
    parser.add_argument("--origins", type=int, default=48)
    parser.add_argument("--spacing", type=int, default=21)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--simulations", type=int, default=5000)
    parser.add_argument("--output-dir", type=Path, default=Path("walk_forward_results"))
    args = parser.parse_args()
    report = run_walk_forward(
        symbol=args.symbol,
        origins=args.origins,
        spacing=args.spacing,
        device=args.device,
        simulations=max(1000, args.simulations),
        output_dir=args.output_dir,
    )
    print(json.dumps(report["aggregate_metrics"], indent=2))


if __name__ == "__main__":
    main()
