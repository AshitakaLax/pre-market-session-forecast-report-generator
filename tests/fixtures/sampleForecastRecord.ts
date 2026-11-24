import {
  auditAndReconcileForecast,
  buildExpectedBins,
  getBinWidthForSymbol,
  HORIZON_SPECS,
} from '../../server/mathAudit.ts';
import type {
  ForecastPayload,
  ForecastRecord,
  HorizonForecast,
  HorizonKey,
  MarketSnapshot,
} from '../../src/types/forecast.ts';
import { PREMARKET_WINDOW_END_ET, PREMARKET_WINDOW_START_ET } from '../../src/constants/premarketWindow.ts';

/**
 * A fully populated forecast record built through the real audit code path.
 *
 * It is typed as ForecastRecord and fills every optional field, so:
 * - adding a field to the TypeScript interfaces forces this fixture to change,
 *   and the schema's additionalProperties:false then fails the test until the
 *   schema is updated too;
 * - adding a required property to the schema fails the test until the
 *   TypeScript types and this fixture are updated.
 */

function normalCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 approximation of the error function.
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

function syntheticHorizon(
  label: string,
  tradingDays: number,
  binWidthPct: number,
  meanPct: number,
  stdPct: number
): HorizonForecast {
  const edges = buildExpectedBins(binWidthPct);
  const cdfAt = (x: number) => normalCdf((x - meanPct) / stdPct);
  const underflow = cdfAt(edges[0].min_pct);
  const overflow = 1 - cdfAt(edges[edges.length - 1].max_pct);
  return {
    label,
    trading_days: tradingDays,
    bin_width_pct: binWidthPct,
    underflow_prob: underflow,
    overflow_prob: overflow,
    bins: edges.map((edge) => ({
      ...edge,
      prob: cdfAt(edge.max_pct) - cdfAt(edge.min_pct),
      cdf: cdfAt(edge.max_pct),
    })),
    // Placeholder summary; the audit recomputes it from the bins.
    summary: {
      mean_pct: meanPct,
      median_pct: meanPct,
      std_pct: stdPct,
      prob_positive: 0.5,
      expected_shortfall_5pct: meanPct - 2 * stdPct,
      quantiles_pct: { p01: 0, p05: 0, p25: 0, p75: 0, p95: 0, p99: 0 },
    },
  };
}

export function buildSampleForecastRecord(): ForecastRecord {
  const leverage = 3;
  const horizons = {} as Record<HorizonKey, HorizonForecast>;
  for (const spec of HORIZON_SPECS) {
    const width = getBinWidthForSymbol(spec.base_bin_width_pct, leverage, 'leveraged_scaled');
    const stdPct = 1.9 * Math.sqrt(spec.trading_days) * leverage;
    horizons[spec.key] = syntheticHorizon(spec.label, spec.trading_days, width, 0.05 * spec.trading_days, stdPct);
  }

  const rawPayload: ForecastPayload = {
    schema_version: '1.1.0',
    symbol: 'TQQQ',
    as_of: '2026-11-24T09:25:00.000Z',
    base_price: 49.1,
    return_type: 'simple_pct',
    model: 'amazon/chronos-2 (fixture)',
    execution_signals: {
      data_quality: {
        confidence_score: 0.8,
        source_coverage: 'mixed',
        missing_inputs: ['put_call_ratio'],
      },
      regime: 'event_driven',
      volatility_state: 'elevated',
      implied_vs_realized_vol_spread_pct: -4.25,
      expected_1d_move_pct: 5.4,
      skew_bias: 'bearish_tail',
      overnight_gap_risk: 'moderate',
      kelly_fraction_cap: 0,
      next_day_catalysts: [
        { time_utc: '2026-11-24T13:30:00.000Z', event: 'US advance retail sales (Oct)', impact: 'high' },
      ],
      suggested_strategy_weights: {
        momentum_trend: 0,
        mean_reversion: 0,
        volatility_harvesting: 0,
        cash_defensive: 1,
      },
    },
    horizons,
  };

  const { payload, audit } = auditAndReconcileForecast(rawPayload, leverage, 'leveraged_scaled');

  const snapshot: MarketSnapshot = {
    symbol: 'TQQQ',
    underlying_symbol: 'QQQ',
    leverage_factor: leverage,
    base_session_date: '2026-11-23',
    as_of_utc: '2026-11-24T09:25:00.000Z',
    market_session_phase: 'pre_market',
    prev_close: 49.1,
    premarket_open_4am: 49.32,
    premarket_window_start_et: PREMARKET_WINDOW_START_ET,
    premarket_window_end_et: PREMARKET_WINDOW_END_ET,
    premarket_window_high: 49.4,
    premarket_window_low: 49.05,
    premarket_window_change_pct: 0.2,
    premarket_window_volume: 41_300,
    premarket_30m_high: 49.6,
    premarket_30m_low: 49.05,
    premarket_30m_change_pct: 0.45,
    premarket_30m_volume: 182_400,
    pre_market_or_latest_price: 49.41,
    pre_market_change_pct: 0.63,
    intraday_high: 50.44,
    intraday_low: 47.31,
    five_day_return_pct: -7.41,
    twenty_day_return_pct: -28.25,
    overnight_futures_symbol: 'NQ=F',
    overnight_futures_change_pct: 0.21,
    futures_daily_change_pct: 1.12,
    vix_level: 26.62,
    vxn_level: 36.31,
    vix9d_level: 27.9,
    vix3m_level: 25.4,
    symbol_iv_pct: 108.93,
    iv_rank_pct: 81,
    put_call_ratio: 0.92,
    realized_vol_20d_pct: 139.75,
    us_2y_yield_pct: 4.31,
    us_10y_yield_pct: 4.92,
    dxy_level: 104.25,
    wti_crude_usd: 79.9,
    fed_watch_summary: 'Fixture: 62% probability of no change at the next FOMC meeting.',
    key_headlines: ['Fixture headline: Nasdaq futures edge higher ahead of retail sales.'],
    next_day_catalysts: [
      { time_utc: '2026-11-24T13:30:00.000Z', event: 'US advance retail sales (Oct)', impact: 'high' },
    ],
    missing_inputs: ['put_call_ratio'],
    confidence_score: 0.8,
    source_coverage: 'mixed',
    raw_research_notes: 'Synthetic fixture used by tests/forecastSchema.test.ts.',
  };

  return {
    id: '7f9c2a4e-5b1d-4c3e-9a8f-0d2e6b7c1a90',
    created_at: '2026-11-24T09:25:00.000Z',
    trigger: 'scheduled',
    calibration_mode: 'leveraged_scaled',
    run_window: 'pre_market',
    payload,
    snapshot,
    sources: [
      {
        title: 'Yahoo Finance daily history: TQQQ',
        uri: 'https://finance.yahoo.com/quote/TQQQ/',
        domain: 'finance.yahoo.com',
      },
    ],
    audit: { ...audit, audited_at: '2026-11-24T09:25:01.000Z' },
    idempotency_key: '2026-11-24T09:05:00Z',
    verification: {
      verified_at: '2026-11-24T21:15:00.000Z',
      target_horizon: 'tomorrow',
      actual_close_price: 50.02,
      actual_return_pct: 1.87,
      brier_score: 0.2116,
      within_iqr_p25_p75: true,
      within_90_p05_p95: true,
      notes: 'Fixture verification.',
      sources: [
        {
          title: 'Yahoo Finance adjusted close: TQQQ',
          uri: 'https://finance.yahoo.com/quote/TQQQ/history/',
          domain: 'finance.yahoo.com',
        },
      ],
    },
  };
}
