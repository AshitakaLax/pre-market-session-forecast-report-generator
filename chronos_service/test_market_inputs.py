"""Offline tests for market_inputs.py (mirrors tests/marketInputs.test.ts)."""

from __future__ import annotations

import unittest
from datetime import date, datetime, time as clock_time

import pandas as pd

from market_inputs import (
    NY,
    choose_daily_series,
    daily_observation,
    intraday_observation,
    iv_rank_pct,
    latest_overnight_vix,
    minute_closes,
    overnight_futures_change,
    overnight_vix_window_open,
    parse_cboe_daily_csv,
    ten_year_yield_pct,
    ten_year_yield_series_pct,
)


def et(day: str, hhmm: str) -> datetime:
    return datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=NY)


def bars(rows: list[tuple[str, str, float]]) -> pd.Series:
    return pd.Series([close for _, _, close in rows], index=pd.DatetimeIndex([et(d, t) for d, t, _ in rows]))


# Prices recorded from Yahoo 1-minute NQ=F and ^VIX bars around 2026-11-20..23.
NQ = bars(
    [
        ("2026-11-20", "15:58", 25044.75),
        ("2026-11-20", "15:59", 25142.0),  # close = price at 16:00:00 ET
        ("2026-11-20", "16:00", 25232.5),
        ("2026-11-23", "03:15", 25896.25),
        ("2026-11-23", "04:20", 26074.25),
        ("2026-11-23", "04:21", 26080.0),
    ]
)
VIX = bars(
    [
        ("2026-11-20", "16:14", 35.89),
        ("2026-11-23", "03:15", 31.37),
        ("2026-11-23", "04:20", 30.09),
        ("2026-11-23", "09:30", 29.5),
    ]
)


class OvernightFuturesTest(unittest.TestCase):
    def test_measures_against_1559_bar(self) -> None:
        result = overnight_futures_change(NQ, date(2026, 11, 20), et("2026-11-23", "04:20"))
        self.assertEqual(result["reference"][0], pd.Timestamp(et("2026-11-20", "15:59")))
        self.assertEqual(result["latest"][1], 26074.25)
        self.assertAlmostEqual(result["change_pct"], (26074.25 / 25142.0 - 1) * 100)

    def test_falls_back_within_ten_minutes(self) -> None:
        series = NQ.drop(pd.Timestamp(et("2026-11-20", "15:59")))
        result = overnight_futures_change(series, date(2026, 11, 20), et("2026-11-23", "04:20"))
        self.assertEqual(result["reference"][1], 25044.75)

    def test_early_close_uses_calendar_close_time(self) -> None:
        series = bars([("2026-11-27", "12:59", 26000.0), ("2026-11-30", "04:20", 26260.0)])
        missing = overnight_futures_change(series, date(2026, 11, 27), et("2026-11-30", "04:20"))
        self.assertIsNone(missing["change_pct"])
        result = overnight_futures_change(
            series, date(2026, 11, 27), et("2026-11-30", "04:20"), close_time=clock_time(13, 0)
        )
        self.assertAlmostEqual(result["change_pct"], 1.0)

    def test_rejects_stale_latest_bar(self) -> None:
        result = overnight_futures_change(NQ, date(2026, 11, 20), et("2026-11-23", "06:00"))
        self.assertIsNone(result["change_pct"])
        self.assertIn("minutes old", result["reason"])


class OvernightVixTest(unittest.TestCase):
    def test_latest_overnight_print(self) -> None:
        stamp, value = latest_overnight_vix(VIX, date(2026, 11, 23), date(2026, 11, 20))
        self.assertEqual(stamp, pd.Timestamp(et("2026-11-23", "04:20")))
        self.assertEqual(value, 30.09)

    def test_respects_snapshot_time(self) -> None:
        _, value = latest_overnight_vix(VIX, date(2026, 11, 23), date(2026, 11, 20), et("2026-11-23", "04:00"))
        self.assertEqual(value, 31.37)

    def test_none_when_today_is_base_session(self) -> None:
        self.assertIsNone(latest_overnight_vix(VIX, date(2026, 11, 23), date(2026, 11, 23)))

    def test_window(self) -> None:
        self.assertTrue(overnight_vix_window_open(et("2026-11-23", "04:20")))
        self.assertFalse(overnight_vix_window_open(et("2026-11-23", "03:20")))
        self.assertFalse(overnight_vix_window_open(et("2026-11-23", "09:30")))
        self.assertFalse(overnight_vix_window_open(et("2026-11-22", "04:20")))  # Sunday


class ParsingTest(unittest.TestCase):
    def test_cboe_csv_uses_close_only(self) -> None:
        csv = (
            "DATE,OPEN,HIGH,LOW,CLOSE\n"
            "11/20/2026,28.630000,40.030000,26.940000,35.890000\n"
            "11/23/2026,31.380000,35.080000,15.390000,26.620000\n"
            "11/24/2026,,,,\n"
        )
        series = parse_cboe_daily_csv(csv)
        self.assertEqual(list(series.index), [date(2026, 11, 20), date(2026, 11, 23)])
        self.assertEqual(list(series), [35.89, 26.62])

    def test_cboe_csv_requires_close(self) -> None:
        with self.assertRaises(ValueError):
            parse_cboe_daily_csv("DATE,VVIX\n11/23/2026,120.1\n")

    def test_minute_closes_drop_bad_rows_and_naive_index(self) -> None:
        index = pd.DatetimeIndex([et("2026-11-24", "04:19"), et("2026-11-24", "04:20")])
        frame = pd.DataFrame({"Close": [27.3, float("nan")]}, index=index)
        self.assertEqual(list(minute_closes(frame)), [27.3])
        self.assertTrue(minute_closes(frame.tz_localize(None)).empty)


class RankAndSelectionTest(unittest.TestCase):
    series = pd.Series(
        [10.0 + (i % 50) for i in range(300)],
        index=[date(2025, 1, 1) + pd.Timedelta(days=i) for i in range(300)],
    )

    def test_iv_rank(self) -> None:
        self.assertEqual(iv_rank_pct(self.series, self.series.index[299]), 100.0)
        self.assertAlmostEqual(iv_rank_pct(self.series, self.series.index[251]), 100.0 / 49.0)
        self.assertIsNone(iv_rank_pct(self.series, self.series.index[250]))

    def test_choose_prefers_cboe_on_tie(self) -> None:
        cboe = pd.Series([40.72], index=[date(2026, 11, 20)])
        yahoo = pd.Series([40.7, 27.76], index=[date(2026, 11, 20), date(2026, 11, 23)])
        candidates = [
            {"source": "cboe_daily_csv", "ticker": "VIX9D", "series": cboe},
            {"source": "yahoo_chart_1d", "ticker": "^VIX9D", "series": yahoo},
        ]
        self.assertEqual(choose_daily_series(candidates, date(2026, 11, 23))["source"], "yahoo_chart_1d")
        self.assertEqual(choose_daily_series(candidates, date(2026, 11, 20))["source"], "cboe_daily_csv")
        self.assertIsNone(choose_daily_series([{"source": "cboe_daily_csv", "ticker": "RVX", "series": None}], date(2026, 11, 23)))

    def test_observation_shapes(self) -> None:
        intraday = intraday_observation(
            "overnight_futures_change_pct", "NQ=F", pd.Timestamp(et("2026-11-24", "04:10")), pd.Timestamp(et("2026-11-23", "15:59"))
        )
        self.assertEqual(intraday["observed_at"], "2026-11-24T09:10:00.000Z")
        self.assertEqual(intraday["reference_observed_at"], "2026-11-23T20:59:00.000Z")
        self.assertEqual(intraday["session_date"], "2026-11-24")
        daily = daily_observation("vix9d_level", "cboe_daily_csv", "VIX9D", date(2026, 11, 23))
        self.assertIsNone(daily["observed_at"])
        self.assertEqual(daily["kind"], "daily_close")


if __name__ == "__main__":
    unittest.main()


class TenYearYieldTest(unittest.TestCase):
    """^TNX in either Yahoo convention (Yahoo now quotes the yield itself)."""

    def test_current_convention_is_the_yield_itself(self) -> None:
        self.assertEqual(ten_year_yield_pct(4.84), 4.84)

    def test_old_x10_convention_is_divided(self) -> None:
        self.assertAlmostEqual(ten_year_yield_pct(48.4), 4.84)

    def test_missing_is_none(self) -> None:
        self.assertIsNone(ten_year_yield_pct(None))
        self.assertIsNone(ten_year_yield_pct(float("nan")))

    def test_a_percent_history_is_unchanged_even_in_a_low_yield_era(self) -> None:
        history = pd.Series([8.43, 1.492, 0.536, 4.875, 4.84])
        pd.testing.assert_series_equal(ten_year_yield_series_pct(history), history)

    def test_a_x10_history_is_divided_as_a_whole(self) -> None:
        # 15.0 here is 1.5% (2020): divided with the rest, never read as 15%.
        history = pd.Series([84.3, 15.0, 5.36, 48.4])
        expected = pd.Series([8.43, 1.5, 0.536, 4.84])
        pd.testing.assert_series_equal(ten_year_yield_series_pct(history), expected)

    def test_empty_history_is_returned_as_is(self) -> None:
        self.assertTrue(ten_year_yield_series_pct(pd.Series([], dtype=float)).empty)
