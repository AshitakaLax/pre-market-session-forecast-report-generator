"""Pre-market inputs observable at ~4:20am ET from free sources.

Mirrors server/marketInputs.ts so both forecast paths compute the same values:

- True overnight index-futures change: latest 1-minute futures close versus the
  futures price at the cash close (normally 4:00pm ET, the end of CME's 30-second
  settlement window) of the last completed session. Yahoo futures quotes are
  roughly 10 minutes delayed.
- Overnight VIX: Cboe disseminates VIX from 3:15am ET; Yahoo 1-minute bars with
  pre/post enabled carry those prints roughly 15 minutes delayed.
- Cboe daily index CSVs (VIX, VIX9D, VIX3M, VXN, RVX, ...), posted ~5:30pm ET the
  same day. Only CLOSE is used: OPEN for VIX is the 3:15am overnight print and
  intraday LOW values can contain bad prints.

These values are for the snapshot and display only. They must NOT become Chronos-2
covariates: no history exists at the same 4:20am clock time (Yahoo keeps about
7 days of 1-minute data), so training on them would be look-ahead.

Everything except fetch_cboe_daily_closes is pure and unit tested offline
(test_market_inputs.py). The module imports neither yfinance nor chronos.
"""

from __future__ import annotations

import io
import threading
import time
import urllib.request
from datetime import date, datetime, time as clock_time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

NY = ZoneInfo("America/New_York")
OVERNIGHT_VIX_START = clock_time(3, 15)
REGULAR_OPEN = clock_time(9, 30)

# Cboe symbol for each volatility index, with the Yahoo daily ticker to fall back
# on. ^RVX is no longer served by Yahoo ("symbol may be delisted"), so RVX has no
# fallback.
CBOE_INDEX_SOURCES: dict[str, dict[str, str | None]] = {
    "^VIX": {"cboe": "VIX", "yahoo_fallback": "^VIX"},
    "^VXN": {"cboe": "VXN", "yahoo_fallback": "^VXN"},
    "^RVX": {"cboe": "RVX", "yahoo_fallback": None},
    "^VIX9D": {"cboe": "VIX9D", "yahoo_fallback": "^VIX9D"},
    "^VIX3M": {"cboe": "VIX3M", "yahoo_fallback": "^VIX3M"},
}

_CBOE_CACHE: dict[str, tuple[float, pd.Series]] = {}
_CBOE_LOCK = threading.Lock()
# The files are republished once per day (~5:30pm ET); an hour keeps runs cheap.
_CBOE_CACHE_SECONDS = 3600


def cboe_csv_url(cboe_symbol: str) -> str:
    return f"https://cdn-api.cboe.com/api/global/us_indices/daily_prices/{cboe_symbol}_History.csv"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_cboe_daily_csv(text: str) -> pd.Series:
    """CLOSE values from a Cboe ``{SYM}_History.csv`` file, indexed by session date."""
    frame = pd.read_csv(io.StringIO(text))
    frame.columns = [str(column).strip().upper() for column in frame.columns]
    if "DATE" not in frame or "CLOSE" not in frame:
        raise ValueError(f"Cboe CSV is missing DATE/CLOSE columns: {list(frame.columns)[:6]}")
    dates = pd.to_datetime(frame["DATE"], format="%m/%d/%Y", errors="coerce")
    closes = pd.to_numeric(frame["CLOSE"], errors="coerce")
    series = pd.Series(closes.to_numpy(), index=[d.date() if pd.notna(d) else None for d in dates])
    series = series[[index is not None for index in series.index]]
    series = series[(series > 0) & series.notna()]
    series = series[~series.index.duplicated(keep="last")].sort_index()
    return series.astype(float)


def minute_closes(frame: pd.DataFrame | None) -> pd.Series:
    """Finite positive 1-minute closes with a tz-aware America/New_York index."""
    if frame is None or frame.empty or "Close" not in frame:
        return pd.Series(dtype=float)
    index = pd.DatetimeIndex(pd.to_datetime(frame.index))
    if index.tz is None:
        return pd.Series(dtype=float)
    closes = pd.to_numeric(frame["Close"], errors="coerce")
    series = pd.Series(closes.to_numpy(dtype=float), index=index.tz_convert(NY))
    series = series[(series > 0) & series.notna()]
    return series[~series.index.duplicated(keep="last")].sort_index()


# ---------------------------------------------------------------------------
# Calculations
# ---------------------------------------------------------------------------


def overnight_futures_change(
    closes: pd.Series,
    session_date: date,
    now_et: datetime,
    close_time: clock_time = clock_time(16, 0),
    max_stale_minutes: float = 60.0,
) -> dict[str, Any]:
    """True overnight futures change (percent) versus the cash close on ``session_date``.

    The reference is the last bar in the ten minutes before ``close_time`` (normally
    the 15:59 ET bar, whose close is the price at exactly 4:00:00pm ET, the end of
    CME's settlement window). With no bar in that window, for example on an early
    close when futures halt at 1:15pm ET and the calendar was unavailable, the change
    is reported as unavailable rather than measured from the wrong time.
    """
    result: dict[str, Any] = {"change_pct": None, "latest": None, "reference": None, "reason": None}
    if closes.empty:
        result["reason"] = "no futures bars"
        return result
    close_at = datetime.combine(session_date, close_time, tzinfo=NY)
    window = closes[(closes.index >= close_at - timedelta(minutes=10)) & (closes.index < close_at)]
    if window.empty:
        result["reason"] = f"no futures bar in the ten minutes before {close_time:%H:%M} ET on {session_date}"
        return result
    reference_ts = window.index[-1]
    result["reference"] = (reference_ts, float(window.iloc[-1]))
    after = closes[(closes.index >= close_at) & (closes.index <= now_et)]
    if after.empty:
        result["reason"] = "no futures bar after the reference close"
        return result
    latest_ts = after.index[-1]
    result["latest"] = (latest_ts, float(after.iloc[-1]))
    age_minutes = (now_et - latest_ts.to_pydatetime()).total_seconds() / 60.0
    if age_minutes > max_stale_minutes:
        result["reason"] = f"latest futures bar is {age_minutes:.0f} minutes old (limit {max_stale_minutes:.0f})"
        return result
    result["change_pct"] = (float(after.iloc[-1]) / float(window.iloc[-1]) - 1.0) * 100.0
    return result


def overnight_vix_window_open(now_et: datetime) -> bool:
    """True from 03:30 ET (first 3:15 print plus Yahoo's ~15-minute delay) to the 09:30 open on weekdays."""
    return now_et.weekday() < 5 and clock_time(3, 30) <= now_et.time() < REGULAR_OPEN


def latest_overnight_vix(
    closes: pd.Series, today_et: date, base_session_date: date, now_et: datetime | None = None
) -> tuple[pd.Timestamp, float] | None:
    """Last VIX print on ``today_et`` between 03:15 and 09:29 ET, if newer than the base session."""
    if closes.empty or today_et <= base_session_date:
        return None
    start = datetime.combine(today_et, OVERNIGHT_VIX_START, tzinfo=NY)
    end = datetime.combine(today_et, REGULAR_OPEN, tzinfo=NY)
    window = closes[(closes.index >= start) & (closes.index < end)]
    if now_et is not None:
        window = window[window.index <= now_et]
    if window.empty:
        return None
    return window.index[-1], float(window.iloc[-1])


def closes_through(series: pd.Series, as_of: date) -> pd.Series:
    return series[[index <= as_of for index in series.index]]


def iv_rank_pct(series: pd.Series, as_of: date, window: int = 252) -> float | None:
    """(last - min) / (max - min) * 100 over the trailing ``window`` closes ending on or before ``as_of``."""
    tail = closes_through(series, as_of).tail(window)
    if len(tail) < window:
        return None
    lo, hi = float(tail.min()), float(tail.max())
    if not hi > lo:
        return None
    return (float(tail.iloc[-1]) - lo) / (hi - lo) * 100.0


def choose_daily_series(candidates: list[dict[str, Any]], as_of: date) -> dict[str, Any] | None:
    """Candidate whose latest close on or before ``as_of`` is newest; earlier candidates win ties."""
    best: dict[str, Any] | None = None
    for candidate in candidates:
        series = candidate.get("series")
        if series is None or len(series) == 0:
            continue
        through = closes_through(series, as_of)
        if through.empty:
            continue
        latest_date = through.index[-1]
        if best is None or latest_date > best["latest_date"]:
            best = {
                "source": candidate["source"],
                "ticker": candidate["ticker"],
                "series": through,
                "latest_date": latest_date,
                "latest": float(through.iloc[-1]),
            }
    return best


def iso_utc(timestamp: pd.Timestamp | datetime) -> str:
    stamp = pd.Timestamp(timestamp)
    return stamp.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%S.000Z")


def daily_observation(field: str, source: str, ticker: str, session_date: date) -> dict[str, Any]:
    return {
        "field": field,
        "source": source,
        "ticker": ticker,
        "kind": "daily_close",
        "observed_at": None,
        "session_date": session_date.isoformat(),
        "reference_observed_at": None,
    }


def intraday_observation(
    field: str,
    ticker: str,
    timestamp: pd.Timestamp,
    reference_timestamp: pd.Timestamp | None = None,
) -> dict[str, Any]:
    return {
        "field": field,
        "source": "yahoo_chart_1m",
        "ticker": ticker,
        "kind": "intraday_bar",
        "observed_at": iso_utc(timestamp),
        "session_date": pd.Timestamp(timestamp).tz_convert(NY).date().isoformat(),
        "reference_observed_at": iso_utc(reference_timestamp) if reference_timestamp is not None else None,
    }


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


def fetch_cboe_daily_closes(cboe_symbol: str, timeout: float = 15.0) -> pd.Series:
    now = time.monotonic()
    with _CBOE_LOCK:
        cached = _CBOE_CACHE.get(cboe_symbol)
        if cached and now - cached[0] < _CBOE_CACHE_SECONDS:
            return cached[1].copy()
    request = urllib.request.Request(cboe_csv_url(cboe_symbol), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed https host
        text = response.read().decode("utf-8", errors="replace")
    series = parse_cboe_daily_csv(text)
    if series.empty:
        raise RuntimeError(f"Cboe CSV for {cboe_symbol} has no valid CLOSE rows.")
    with _CBOE_LOCK:
        _CBOE_CACHE[cboe_symbol] = (time.monotonic(), series.copy())
    return series
