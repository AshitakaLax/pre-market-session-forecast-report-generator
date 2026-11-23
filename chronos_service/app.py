from __future__ import annotations

import hmac
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from datetime import date, datetime, time as clock_time, timedelta
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pandas_market_calendars as mcal
import yfinance as yf
from chronos import Chronos2Pipeline
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from scenarios import QUANTILE_LEVELS, build_horizon_distributions, simulate_cumulative_returns

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("meridian-chronos")

MODEL_ID = os.getenv("CHRONOS_MODEL_ID", "amazon/chronos-2")
DEVICE = os.getenv("CHRONOS_DEVICE", "cpu")
CONTEXT_LENGTH = min(8192, int(os.getenv("CHRONOS_CONTEXT_LENGTH", "8192")))
SIMULATIONS = max(1000, int(os.getenv("CHRONOS_SIMULATIONS", "10000")))
BLOCK_LENGTH = max(2, int(os.getenv("CHRONOS_BLOCK_LENGTH", "5")))
CACHE_TTL_SECONDS = max(60, int(os.getenv("MARKET_DATA_CACHE_SECONDS", "600")))
API_TOKEN = os.getenv("CHRONOS_API_TOKEN", "")
NY = ZoneInfo("America/New_York")

MODEL: Chronos2Pipeline | None = None
MODEL_LOCK = threading.Lock()
CACHE_LOCK = threading.Lock()
HISTORY_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}

PROFILE_MAP: dict[str, dict[str, Any]] = {
    "TQQQ": {"underlying": "QQQ", "leverage": 3, "volatility": "^VXN", "futures": "NQ=F"},
    "SQQQ": {"underlying": "QQQ", "leverage": 3, "volatility": "^VXN", "futures": "NQ=F"},
    "QLD": {"underlying": "QQQ", "leverage": 2, "volatility": "^VXN", "futures": "NQ=F"},
    "QID": {"underlying": "QQQ", "leverage": 2, "volatility": "^VXN", "futures": "NQ=F"},
    "QQQ": {"underlying": "QQQ", "leverage": 1, "volatility": "^VXN", "futures": "NQ=F"},
    "UPRO": {"underlying": "SPY", "leverage": 3, "volatility": "^VIX", "futures": "ES=F"},
    "SPXU": {"underlying": "SPY", "leverage": 3, "volatility": "^VIX", "futures": "ES=F"},
    "SSO": {"underlying": "SPY", "leverage": 2, "volatility": "^VIX", "futures": "ES=F"},
    "SPY": {"underlying": "SPY", "leverage": 1, "volatility": "^VIX", "futures": "ES=F"},
    "SOXL": {"underlying": "SOXX", "leverage": 3, "volatility": "^VXN", "futures": "NQ=F"},
    "SOXS": {"underlying": "SOXX", "leverage": 3, "volatility": "^VXN", "futures": "NQ=F"},
    "TNA": {"underlying": "IWM", "leverage": 3, "volatility": "^RVX", "futures": "RTY=F"},
}


class HorizonBin(BaseModel):
    min_pct: float
    max_pct: float


class HorizonSpec(BaseModel):
    key: str
    label: str
    trading_days: int = Field(ge=1, le=252)
    bin_width_pct: float = Field(gt=0)
    bins: list[HorizonBin] = Field(min_length=10, max_length=10)


class ForecastRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    run_window: str = "pre_market"
    calibration_mode: str = "leveraged_scaled"
    horizon_specs: list[HorizonSpec] = Field(min_length=5, max_length=5)


class VerifyRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    base_date: date


def authorize(authorization: str | None) -> None:
    if API_TOKEN and not hmac.compare_digest(authorization or "", f"Bearer {API_TOKEN}"):
        raise HTTPException(status_code=401, detail="Invalid Chronos service token.")


def _normalize_history(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    result = frame.copy()
    index = pd.DatetimeIndex(pd.to_datetime(result.index))
    if index.tz is not None:
        index = index.tz_convert(NY).tz_localize(None)
    result.index = index.normalize()
    result = result[~result.index.duplicated(keep="last")].sort_index()
    for column in ("Open", "High", "Low", "Close", "Volume"):
        if column in result:
            result[column] = pd.to_numeric(result[column], errors="coerce")
    return result


def _fetch_daily_history(ticker: str) -> pd.DataFrame:
    now = time.monotonic()
    with CACHE_LOCK:
        cached = HISTORY_CACHE.get(ticker)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1].copy()

    frame = yf.Ticker(ticker).history(
        period="max",
        interval="1d",
        auto_adjust=True,
        actions=False,
        timeout=25,
        raise_errors=True,
    )
    frame = _normalize_history(frame)
    if frame.empty or "Close" not in frame:
        raise RuntimeError(f"No daily market history returned for {ticker}.")

    with CACHE_LOCK:
        HISTORY_CACHE[ticker] = (time.monotonic(), frame.copy())
    return frame


def _fetch_histories(tickers: list[str]) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    histories: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}
    unique = list(dict.fromkeys(tickers))
    with ThreadPoolExecutor(max_workers=min(6, len(unique))) as pool:
        futures = {pool.submit(_fetch_daily_history, ticker): ticker for ticker in unique}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                histories[ticker] = future.result()
            except Exception as exc:  # provider outages are recorded as missing inputs
                errors[ticker] = str(exc)[:240]
                logger.warning("Market-data fetch failed for %s: %s", ticker, exc)
    return histories, errors


def _regular_session_phase(now_et: datetime) -> str:
    if now_et.weekday() >= 5:
        return "closed"
    try:
        calendar = mcal.get_calendar("NASDAQ")
        schedule = calendar.schedule(start_date=now_et.date(), end_date=now_et.date())
        if schedule.empty:
            return "closed"
        market_open = schedule.iloc[0]["market_open"].tz_convert(NY).time()
        market_close = schedule.iloc[0]["market_close"].tz_convert(NY).time()
    except Exception:
        market_open, market_close = clock_time(9, 30), clock_time(16, 0)

    current = now_et.time()
    if current < clock_time(4, 0):
        return "closed"
    if current < market_open:
        return "pre_market"
    if current < market_close:
        return "regular_open"
    if current < clock_time(20, 0):
        return "after_hours"
    return "closed"


def _last_complete_daily_history(frame: pd.DataFrame, now_et: datetime) -> pd.DataFrame:
    # During premarket and the regular session, the current daily candle is incomplete.
    if now_et.time() < clock_time(16, 10):
        return frame.loc[frame.index.date < now_et.date()].copy()
    return frame.copy()


def _intraday_premarket(symbol: str, now_et: datetime) -> dict[str, Any]:
    result = {
        "open_4am": None,
        "high_30m": None,
        "low_30m": None,
        "change_30m_pct": None,
        "volume_30m": None,
        "latest_price": None,
    }
    if now_et.weekday() >= 5 or now_et.time() >= clock_time(9, 30) or now_et.time() < clock_time(4, 0):
        return result
    try:
        frame = yf.Ticker(symbol).history(
            period="5d",
            interval="1m",
            prepost=True,
            auto_adjust=True,
            actions=False,
            timeout=15,
        )
        if frame is None or frame.empty:
            return result
        index = pd.DatetimeIndex(pd.to_datetime(frame.index))
        if index.tz is None:
            return result
        frame = frame.copy()
        frame.index = index.tz_convert(NY)
        today = frame.loc[frame.index.date == now_et.date()]
        pre = today.between_time("04:00", "09:29")
        opening = today.between_time("04:00", "04:29")
        if not pre.empty:
            result["latest_price"] = float(pre["Close"].iloc[-1])
        if not opening.empty:
            first = opening.iloc[0]
            last = opening.iloc[-1]
            result.update(
                {
                    "open_4am": float(first["Open"]),
                    "high_30m": float(opening["High"].max()),
                    "low_30m": float(opening["Low"].min()),
                    "change_30m_pct": float((last["Close"] / first["Open"] - 1) * 100),
                    "volume_30m": float(opening["Volume"].fillna(0).sum()),
                }
            )
    except Exception as exc:
        logger.info("Premarket minute data unavailable for %s: %s", symbol, exc)
    return result


def _close_series(histories: dict[str, pd.DataFrame], ticker: str) -> pd.Series | None:
    frame = histories.get(ticker)
    if frame is None or frame.empty or "Close" not in frame:
        return None
    series = frame["Close"].replace([np.inf, -np.inf], np.nan).dropna()
    return series if not series.empty else None


def _return_series(series: pd.Series) -> pd.Series:
    return np.log(series / series.shift(1)) * 100.0

def _calendar_covariates(index: pd.DatetimeIndex) -> pd.DataFrame:
    """Deterministic covariates known for every future Nasdaq trading session."""
    dates = pd.DatetimeIndex(index)
    weekday_angle = 2.0 * np.pi * dates.dayofweek.to_numpy(dtype=float) / 5.0
    year_angle = 2.0 * np.pi * dates.dayofyear.to_numpy(dtype=float) / 365.25
    month_angle = 2.0 * np.pi * (dates.month.to_numpy(dtype=float) - 1.0) / 12.0
    day_angle = 2.0 * np.pi * (dates.day.to_numpy(dtype=float) - 1.0) / 31.0
    return pd.DataFrame(
        {
            "calendar_weekday_sin": np.sin(weekday_angle),
            "calendar_weekday_cos": np.cos(weekday_angle),
            "calendar_year_sin": np.sin(year_angle),
            "calendar_year_cos": np.cos(year_angle),
            "calendar_month_sin": np.sin(month_angle),
            "calendar_month_cos": np.cos(month_angle),
            "calendar_day_sin": np.sin(day_angle),
            "calendar_day_cos": np.cos(day_angle),
        },
        index=dates,
    )


def _future_market_sessions(last_session: date, count: int) -> pd.DatetimeIndex:
    """Return the next N actual Nasdaq sessions, including known holidays/closures."""
    calendar = mcal.get_calendar("NASDAQ")
    end_date = last_session + timedelta(days=max(180, int(count * 1.8)))
    schedule = calendar.schedule(
        start_date=last_session + timedelta(days=1),
        end_date=end_date,
    )
    sessions = pd.DatetimeIndex(schedule.index).normalize()
    if len(sessions) < count:
        end_date = last_session + timedelta(days=max(730, int(count * 3)))
        schedule = calendar.schedule(
            start_date=last_session + timedelta(days=1),
            end_date=end_date,
        )
        sessions = pd.DatetimeIndex(schedule.index).normalize()
    if len(sessions) < count:
        raise RuntimeError(f"Could not construct {count} future Nasdaq trading sessions.")
    return sessions[:count]



def _build_training_frame(
    symbol: str,
    profile: dict[str, Any],
    histories: dict[str, pd.DataFrame],
    target_history: pd.DataFrame,
) -> tuple[pd.DataFrame, list[str], dict[str, str]]:
    close = target_history["Close"].astype(float)
    returns = _return_series(close)
    frame = pd.DataFrame({"target": returns}, index=target_history.index)
    missing: dict[str, str] = {}
    candidate_features: dict[str, pd.Series] = {}

    underlying = str(profile["underlying"])
    for ticker, feature in (
        (underlying, "underlying_return_pct"),
        ("SPY", "spy_return_pct"),
        (str(profile["futures"]), "index_futures_return_pct"),
    ):
        if ticker == symbol or feature in candidate_features:
            continue
        series = _close_series(histories, ticker)
        if series is not None:
            candidate_features[feature] = _return_series(series).reindex(frame.index)
        else:
            missing[feature] = f"Historical series {ticker} unavailable."

    seen_volatility_tickers: set[str] = set()
    for ticker, feature in (("^VIX", "vix_level"), (str(profile["volatility"]), "primary_volatility_index")):
        if ticker == symbol or ticker in seen_volatility_tickers:
            continue
        seen_volatility_tickers.add(ticker)
        series = _close_series(histories, ticker)
        if series is not None:
            candidate_features[feature] = series.reindex(frame.index) / 100.0
        else:
            missing[feature] = f"Historical volatility series {ticker} unavailable."

    # Market-derived features use only information available at each daily close.
    calendar_features = _calendar_covariates(pd.DatetimeIndex(frame.index))
    for name in calendar_features.columns:
        candidate_features[name] = calendar_features[name]

    for ticker, feature in (
        ("^TNX", "us_10y_yield_level"),
        ("DX-Y.NYB", "dxy_return_pct"),
        ("CL=F", "wti_return_pct"),
    ):
        series = _close_series(histories, ticker)
        if series is not None:
            if ticker == "^TNX":
                candidate_features[feature] = (series / 10.0).reindex(frame.index)
            else:
                candidate_features[feature] = _return_series(series).reindex(frame.index)
        else:
            missing[feature] = f"Historical series {ticker} unavailable."

    candidate_features["realized_volatility_20d"] = returns.rolling(20).std() * np.sqrt(252)
    candidate_features["momentum_5d_pct"] = returns.rolling(5).sum()
    candidate_features["momentum_20d_pct"] = returns.rolling(20).sum()

    previous_close = close.shift(1)
    if "Open" in target_history:
        candidate_features["overnight_gap_pct"] = (
            np.log(target_history["Open"].astype(float) / previous_close) * 100.0
        )
    if {"High", "Low"}.issubset(target_history.columns):
        candidate_features["intraday_range_pct"] = (
            (target_history["High"].astype(float) - target_history["Low"].astype(float))
            / previous_close
            * 100.0
        )
    if "Volume" in target_history:
        volume = target_history["Volume"].astype(float).replace(0, np.nan)
        volume_mean = volume.rolling(20).mean()
        candidate_features["volume_surprise_log"] = np.log(volume / volume_mean)

    included: list[str] = []
    for name, series in candidate_features.items():
        aligned = series.reindex(frame.index).replace([np.inf, -np.inf], np.nan)
        coverage = float(aligned.notna().mean())
        if coverage < 0.75:
            missing[name] = f"Only {coverage:.0%} historical coverage; excluded from model inputs."
            continue
        frame[name] = aligned.ffill(limit=5)
        included.append(name)

    frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
    if len(frame) > CONTEXT_LENGTH:
        frame = frame.tail(CONTEXT_LENGTH)
    return frame, included, missing


def _premarket_snapshot(
    symbol: str,
    now_et: datetime,
    previous_close: float,
) -> tuple[dict[str, Any], list[str]]:
    minute = _intraday_premarket(symbol, now_et)
    latest = minute["latest_price"] if minute["latest_price"] is not None else previous_close
    missing: list[str] = []
    if minute["latest_price"] is None and now_et.time() < clock_time(9, 30) and now_et.time() >= clock_time(4, 0):
        missing.append("Premarket minute tape is unavailable from the selected free data adapter.")
    change = (float(latest) / previous_close - 1.0) * 100.0 if previous_close > 0 else None
    return {
        "pre_market_or_latest_price": float(latest),
        "pre_market_change_pct": float(change) if change is not None else None,
        "premarket_open_4am": minute["open_4am"],
        "premarket_30m_high": minute["high_30m"],
        "premarket_30m_low": minute["low_30m"],
        "premarket_30m_change_pct": minute["change_30m_pct"],
        "premarket_30m_volume": minute["volume_30m"],
    }, missing


def _safe_last(series: pd.Series | None) -> float | None:
    if series is None or len(series) == 0:
        return None
    value = float(series.iloc[-1])
    return value if np.isfinite(value) else None


def _make_market_snapshot(
    symbol: str,
    profile: dict[str, Any],
    histories: dict[str, pd.DataFrame],
    target_history: pd.DataFrame,
    training: pd.DataFrame,
    covariates: list[str],
    missing_inputs: list[str],
    now_et: datetime,
) -> tuple[dict[str, Any], float]:
    close = target_history["Close"].astype(float)
    base_price = float(close.iloc[-1])
    premarket, premarket_missing = _premarket_snapshot(symbol, now_et, base_price)
    missing_inputs.extend(premarket_missing)

    def latest_close(ticker: str) -> pd.Series | None:
        frame = histories.get(ticker)
        if frame is None or frame.empty or "Close" not in frame:
            return None
        completed = _last_complete_daily_history(frame, now_et)
        if completed.empty:
            return None
        return completed["Close"].replace([np.inf, -np.inf], np.nan).dropna()

    vol_series = latest_close(str(profile["volatility"]))
    vix_series = latest_close("^VIX")
    vxn_series = latest_close("^VXN")
    futures_series = latest_close(str(profile["futures"]))
    dxy_series = latest_close("DX-Y.NYB")
    crude_series = latest_close("CL=F")
    treasury_series = latest_close("^TNX")

    last_intraday = target_history.iloc[-1]
    five_day = (float(close.iloc[-1]) / float(close.iloc[-6]) - 1) * 100 if len(close) >= 6 else None
    twenty_day = (float(close.iloc[-1]) / float(close.iloc[-21]) - 1) * 100 if len(close) >= 21 else None
    returns = _return_series(close).dropna()
    rv20 = float(returns.tail(20).std(ddof=1) * np.sqrt(252)) if len(returns) >= 20 else None

    vix_level = _safe_last(vix_series)
    vxn_level = _safe_last(vxn_series)
    implied_level = _safe_last(vol_series)
    if implied_level is not None and str(profile["volatility"]) not in ("^VIX", "^VXN", "^RVX"):
        implied_level = None
    if implied_level is not None:
        # Convert underlying-index implied volatility to an approximate
        # symbol-level value for daily leveraged/inverse ETF comparisons.
        implied_level *= float(profile["leverage"])

    futures_change = None
    if futures_series is not None and len(futures_series) >= 2:
        futures_change = (float(futures_series.iloc[-1]) / float(futures_series.iloc[-2]) - 1) * 100

    missing_inputs.extend(
        [
            name
            for name, value in (
                ("vix_level", vix_level),
                ("vxn_level", vxn_level),
                ("overnight_futures_change_pct", futures_change),
                ("us_10y_yield_pct", _safe_last(treasury_series)),
            )
            if value is None
        ]
    )
    coverage_score = min(1.0, len(covariates) / 14.0)
    source_coverage = "mixed" if len(training) >= 500 and len(covariates) >= 3 else "degraded"

    snapshot = {
        "symbol": symbol,
        "underlying_symbol": profile["underlying"],
        "leverage_factor": profile["leverage"],
        "as_of_utc": datetime.now().astimezone().isoformat(),
        "market_session_phase": _regular_session_phase(now_et),
        "prev_close": base_price,
        **premarket,
        "intraday_high": float(last_intraday["High"]) if "High" in last_intraday and pd.notna(last_intraday["High"]) else None,
        "intraday_low": float(last_intraday["Low"]) if "Low" in last_intraday and pd.notna(last_intraday["Low"]) else None,
        "five_day_return_pct": float(five_day) if five_day is not None else None,
        "twenty_day_return_pct": float(twenty_day) if twenty_day is not None else None,
        "overnight_futures_symbol": profile["futures"],
        "overnight_futures_change_pct": float(futures_change) if futures_change is not None else None,
        "vix_level": float(vix_level) if vix_level is not None else None,
        "vxn_level": float(vxn_level) if vxn_level is not None else None,
        "vix9d_level": None,
        "vix3m_level": None,
        "symbol_iv_pct": float(implied_level) if implied_level is not None else None,
        "iv_rank_pct": None,
        "put_call_ratio": None,
        "realized_vol_20d_pct": float(rv20) if rv20 is not None else None,
        "us_2y_yield_pct": None,
        "us_10y_yield_pct": float(_safe_last(treasury_series) / 10.0) if _safe_last(treasury_series) is not None else None,
        "dxy_level": float(_safe_last(dxy_series)) if _safe_last(dxy_series) is not None else None,
        "wti_crude_usd": float(_safe_last(crude_series)) if _safe_last(crude_series) is not None else None,
        "fed_watch_summary": "Not supplied by the Yahoo Finance daily-history adapter.",
        "key_headlines": [],
        "next_day_catalysts": [],
        "missing_inputs": list(dict.fromkeys(missing_inputs)),
        "confidence_score": float(coverage_score),
        "source_coverage": source_coverage,
        "raw_research_notes": (
            "Amazon Chronos-2 forecast of adjusted daily log returns. "
            "Native direct quantile forecasts are used through the model-native prediction horizon; "
            "longer horizons use a conservative historical standardized-innovation extension. "
            "Deterministic calendar features are supplied as known future covariates. "
            "Daily marginal quantiles are transformed into cumulative multi-horizon scenarios "
            "using five-session circular block-bootstrap innovations from historical standardized returns. "
            "Forecasts are anchored to the last completed regular-session close. "
            "The free Yahoo Finance adapter does not provide verified options positioning, a complete economic calendar, "
            "or institutional-grade real-time market data. This model has not yet been walk-forward calibrated."
        ),
    }
    return snapshot, base_price


def _execution_signals(
    training: pd.DataFrame,
    snapshot: dict[str, Any],
    distributions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    returns = training["target"].to_numpy(dtype=np.float64)
    realized_vol = training["target"].rolling(20).std() * np.sqrt(252)
    rv_values = realized_vol.dropna().tail(252).to_numpy()
    current_rv = float(rv_values[-1]) if len(rv_values) else 0.0
    q50 = float(np.quantile(rv_values, 0.50)) if len(rv_values) else current_rv
    q85 = float(np.quantile(rv_values, 0.85)) if len(rv_values) else current_rv
    q97 = float(np.quantile(rv_values, 0.97)) if len(rv_values) else current_rv

    if current_rv < q50:
        volatility_state = "compressed"
    elif current_rv < q85:
        volatility_state = "normal"
    elif current_rv < q97:
        volatility_state = "elevated"
    else:
        volatility_state = "extreme"

    momentum20 = float(np.sum(returns[-20:])) if len(returns) >= 20 else 0.0
    if momentum20 > 2.0 and volatility_state in ("compressed", "normal"):
        regime = "low_vol_uptrend"
    elif momentum20 > 2.0:
        regime = "breakout_expansion"
    elif momentum20 < -2.0:
        regime = "high_vol_downtrend"
    else:
        regime = "mean_reverting_range"

    one_day = distributions["tomorrow"]["summary"]
    q05 = float(one_day["quantiles_pct"]["p05"])
    q50 = float(one_day["median_pct"])
    q95 = float(one_day["quantiles_pct"]["p95"])
    left_tail = abs(q05 - q50)
    right_tail = abs(q95 - q50)
    if left_tail > right_tail * 1.2:
        skew_bias = "bearish_tail"
    elif right_tail > left_tail * 1.2:
        skew_bias = "bullish_tail"
    else:
        skew_bias = "neutral"

    gap = snapshot.get("pre_market_change_pct")
    if gap is None:
        gap_risk = "moderate"
    elif abs(float(gap)) >= 2.0:
        gap_risk = "high"
    elif abs(float(gap)) >= 0.75:
        gap_risk = "moderate"
    else:
        gap_risk = "low"

    implied = snapshot.get("symbol_iv_pct")
    rv20 = snapshot.get("realized_vol_20d_pct")
    vol_spread = float(implied - rv20) if implied is not None and rv20 is not None else 0.0

    return {
        "data_quality": {
            "confidence_score": float(snapshot["confidence_score"]),
            "source_coverage": snapshot["source_coverage"],
            "missing_inputs": snapshot["missing_inputs"],
        },
        "regime": regime,
        "volatility_state": volatility_state,
        "implied_vs_realized_vol_spread_pct": vol_spread,
        "expected_1d_move_pct": float(max(0.0, one_day["quantiles_pct"]["p95"] - one_day["quantiles_pct"]["p05"]) / 2.0),
        "skew_bias": skew_bias,
        "overnight_gap_risk": gap_risk,
        # Position sizing stays disabled until model output is walk-forward calibrated.
        "kelly_fraction_cap": 0.0,
        "next_day_catalysts": [],
        "suggested_strategy_weights": {
            "momentum_trend": 0.0,
            "mean_reversion": 0.0,
            "volatility_harvesting": 0.0,
            "cash_defensive": 1.0,
        },
    }


def _build_sources(histories: dict[str, pd.DataFrame]) -> list[dict[str, str]]:
    return [
        {
            "title": f"Yahoo Finance daily history: {ticker}",
            "uri": f"https://finance.yahoo.com/quote/{quote(ticker, safe='')}/",
            "domain": "finance.yahoo.com",
        }
        for ticker in sorted(histories)
    ]


def _generate_forecast(request: ForecastRequest, pipeline: Chronos2Pipeline) -> dict[str, Any]:
    symbol = request.symbol.strip().upper()
    if not symbol or not symbol.replace(".", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid market symbol.")

    profile = PROFILE_MAP.get(
        symbol,
        {"underlying": symbol, "leverage": 1, "volatility": "^VIX", "futures": "ES=F"},
    )
    now_et = datetime.now(NY)
    phase = _regular_session_phase(now_et)
    tickers = [
        symbol,
        str(profile["underlying"]),
        "SPY",
        "^VIX",
        "^VXN",
        str(profile["futures"]),
        "^TNX",
        "DX-Y.NYB",
        "CL=F",
    ]
    histories, fetch_errors = _fetch_histories(tickers)
    if symbol not in histories:
        raise HTTPException(
            status_code=503,
            detail=f"Market data for {symbol} is unavailable from the configured data adapter: {fetch_errors.get(symbol, 'no daily history returned')}",
        )

    target_history = _last_complete_daily_history(histories[symbol], now_et)
    if len(target_history) < 300:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(target_history)} completed daily bars are available for {symbol}; at least 300 are required.",
        )

    last_date = target_history.index[-1].date()
    business_days_stale = max(0, len(pd.bdate_range(last_date + timedelta(days=1), now_et.date())))
    if business_days_stale > 3:
        raise HTTPException(
            status_code=503,
            detail=f"The latest completed daily bar for {symbol} is {business_days_stale} business days old. Refusing to forecast on stale market data.",
        )

    training, covariates, missing = _build_training_frame(symbol, profile, histories, target_history)
    if len(training) < 300:
        raise HTTPException(
            status_code=422,
            detail=f"Only {len(training)} aligned observations remain after aligning target and covariates; at least 300 are required.",
        )

    max_horizon = max(int(spec.trading_days) for spec in request.horizon_specs)
    target_values = training["target"].to_numpy(dtype=np.float32)
    past_covariates = {
        name: training[name].to_numpy(dtype=np.float32)
        for name in covariates
    }
    model_native_horizon = int(getattr(pipeline, "model_prediction_length", 64))
    direct_horizon = min(
        max_horizon,
        model_native_horizon,
        max(1, int(os.getenv("CHRONOS_DIRECT_HORIZON", "64"))),
    )
    future_sessions = _future_market_sessions(last_date, direct_horizon)
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
        direct_daily_quantiles = quantiles[0].detach().cpu().numpy()[0]
        from scenarios import extend_daily_quantiles

        daily_quantiles, horizon_extension = extend_daily_quantiles(
            direct_quantiles_pct=direct_daily_quantiles,
            history_returns_pct=target_values[-min(len(target_values), 1260):],
            total_prediction_length=max_horizon,
        )
    except Exception as exc:
        logger.exception("Chronos-2 inference failed")
        raise HTTPException(status_code=503, detail=f"Chronos-2 inference failed: {str(exc)[:500]}") from exc

    seed = (sum(ord(char) for char in symbol) + int(now_et.strftime("%Y%m%d"))) % (2**32 - 1)
    paths = simulate_cumulative_returns(
        daily_quantiles_pct=daily_quantiles,
        history_returns_pct=target_values[-min(len(target_values), 1260):],
        n_paths=SIMULATIONS,
        block_length=BLOCK_LENGTH,
        seed=seed,
    )
    horizon_specs = [spec.model_dump() for spec in request.horizon_specs]
    distributions = build_horizon_distributions(paths, horizon_specs)

    snapshot, base_price = _make_market_snapshot(
        symbol,
        profile,
        histories,
        target_history,
        training,
        covariates,
        list(missing.values()) + [f"{ticker}: {error}" for ticker, error in fetch_errors.items() if ticker != symbol],
        now_et,
    )
    signals = _execution_signals(training, snapshot, distributions)
    raw_payload = {
        "schema_version": "1.1.0",
        "symbol": symbol,
        "as_of": datetime.now().astimezone().isoformat(),
        "base_price": base_price,
        "return_type": "simple_pct",
        "model": f"{MODEL_ID} (daily quantiles + {BLOCK_LENGTH}-session block bootstrap; {SIMULATIONS:,} scenarios)",
        "execution_signals": signals,
        "horizons": distributions,
    }
    return {
        "snapshot": snapshot,
        "sources": _build_sources(histories),
        "raw_payload": raw_payload,
        "diagnostics": {
            "model_id": MODEL_ID,
            "device": DEVICE,
            "history_observations": len(training),
            "covariates_used": covariates,
            "simulation_paths": SIMULATIONS,
            "block_length": BLOCK_LENGTH,
            "forecast_steps": max_horizon,
            "chronos_direct_steps": direct_horizon,
            "historical_extension_steps": max_horizon - direct_horizon,
            "long_horizon_extension": horizon_extension,
            "last_completed_session": last_date.isoformat(),
            "anchor_price_type": "last_completed_regular_session_close",
            "calibration_status": "uncalibrated_zero_shot",
            "native_model_horizon": int(getattr(pipeline, "model_prediction_length", 64)),
            "horizon_extension_method": "historical_standardized_innovation",
        },
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL
    import torch

    torch.set_num_threads(max(1, int(os.getenv("CHRONOS_CPU_THREADS", "4"))))
    logger.info("Loading %s on %s", MODEL_ID, DEVICE)
    MODEL = Chronos2Pipeline.from_pretrained(MODEL_ID, device_map=DEVICE)
    logger.info("Loaded %s", MODEL_ID)
    yield
    MODEL = None


app = FastAPI(title="Meridian Quant Chronos-2 Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok" if MODEL is not None else "loading",
        "model_id": MODEL_ID,
        "model_loaded": MODEL is not None,
        "device": DEVICE,
        "data_provider": "Yahoo Finance via yfinance (unofficial; personal research use only)",
        "context_length": CONTEXT_LENGTH,
        "simulations": SIMULATIONS,
    }


@app.post("/forecast")
def forecast(request: ForecastRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Chronos-2 model is still loading.")
    with MODEL_LOCK:
        return _generate_forecast(request, MODEL)


@app.post("/verify")
def verify(request: VerifyRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    symbol = request.symbol.strip().upper()
    end_date = request.base_date + timedelta(days=14)
    try:
        frame = yf.Ticker(symbol).history(
            start=request.base_date.isoformat(),
            end=end_date.isoformat(),
            interval="1d",
            auto_adjust=True,
            actions=False,
            timeout=20,
            raise_errors=True,
        )
        frame = _normalize_history(frame)
        frame = frame.loc[frame.index.date >= request.base_date]
        if frame.empty:
            return {"found": False, "session_date": None, "actual_close_price": None, "notes": "No completed close is available yet."}
        session = frame.iloc[0]
        return {
            "found": True,
            "session_date": frame.index[0].date().isoformat(),
            "actual_close_price": float(session["Close"]),
            "notes": f"Retrieved the first available regular-session adjusted close for {symbol} from Yahoo Finance.",
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Realized-close retrieval failed: {str(exc)[:400]}") from exc
