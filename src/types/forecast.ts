// These interfaces mirror schemas/forecast-record.schema.json (JSON Schema 2020-12).
// Change both together: tests/forecastSchema.test.ts fails when they drift apart,
// and server/storage.ts refuses to persist a record that violates the schema.

export type RegimeType =
  | 'low_vol_uptrend'
  | 'high_vol_downtrend'
  | 'mean_reverting_range'
  | 'breakout_expansion'
  | 'event_driven';

export type VolatilityState = 'compressed' | 'normal' | 'elevated' | 'extreme';
export type SkewBias = 'bearish_tail' | 'neutral' | 'bullish_tail';
export type GapRisk = 'low' | 'moderate' | 'high';
export type SourceCoverage = 'primary_verified' | 'mixed' | 'degraded';
export type CatalystImpact = 'low' | 'medium' | 'high';
export type HorizonKey = 'tomorrow' | 'next_week' | 'next_month' | 'next_quarter' | 'next_year';
export type CalibrationMode = 'leveraged_scaled' | 'original_1x';
export type RunWindow = 'pre_market' | 'pre_bell' | 'eod';

/** Payload contract version; must match the `const` in schemas/forecast-record.schema.json. */
export const FORECAST_SCHEMA_VERSION = '1.2.0';

export interface CatalystItem {
  time_utc: string;
  event: string;
  impact: CatalystImpact;
}

export interface StrategyWeights {
  momentum_trend: number;
  mean_reversion: number;
  volatility_harvesting: number;
  cash_defensive: number;
}

export interface ExecutionSignals {
  data_quality: {
    confidence_score: number;
    source_coverage: SourceCoverage;
    missing_inputs: string[];
  };
  regime: RegimeType;
  volatility_state: VolatilityState;
  implied_vs_realized_vol_spread_pct: number;
  expected_1d_move_pct: number;
  skew_bias: SkewBias;
  overnight_gap_risk: GapRisk;
  kelly_fraction_cap: number;
  next_day_catalysts: CatalystItem[];
  suggested_strategy_weights: StrategyWeights;
}

export interface BinItem {
  min_pct: number;
  max_pct: number;
  prob: number;
  cdf: number;
}

export interface HorizonSummary {
  mean_pct: number;
  median_pct: number;
  std_pct: number;
  prob_positive: number;
  expected_shortfall_5pct: number;
  quantiles_pct: {
    p01: number;
    p05: number;
    p25: number;
    p75: number;
    p95: number;
    p99: number;
  };
}

export interface HorizonForecast {
  label: string;
  trading_days: number;
  bin_width_pct: number;
  underflow_prob: number;
  overflow_prob: number;
  bins: BinItem[];
  summary: HorizonSummary;
}

export interface ForecastPayload {
  schema_version: string;
  symbol: string;
  as_of: string;
  base_price: number;
  return_type: 'simple_pct';
  model: string;
  execution_signals: ExecutionSignals;
  horizons: Record<HorizonKey, HorizonForecast>;
}

export interface GroundingSource {
  title: string;
  uri: string;
  domain: string;
}

export type InputObservationSource = 'yahoo_chart_1m' | 'yahoo_chart_1d' | 'cboe_daily_csv';
export type InputObservationKind = 'intraday_bar' | 'daily_close';

/**
 * Provenance for one snapshot input: where it came from and when it was observed.
 * The snapshot's as_of_utc is when the snapshot was assembled; these say how old
 * each input was at that moment.
 */
export interface InputObservation {
  /** MarketSnapshot field this observation populates. */
  field: string;
  source: InputObservationSource;
  /** Ticker at the source (Yahoo symbol such as NQ=F, or Cboe symbol such as VIX9D). */
  ticker: string;
  kind: InputObservationKind;
  /** intraday_bar: Yahoo 1-minute bar timestamp (bar start) whose close is used. null for daily_close. */
  observed_at: string | null;
  /** daily_close: session whose close is used. intraday_bar: America/New_York date of the bar. */
  session_date: string;
  /** For change fields: timestamp of the reference bar (e.g. the 15:59 ET futures bar). */
  reference_observed_at: string | null;
}

export interface MarketSnapshot {
  symbol: string;
  underlying_symbol: string;
  leverage_factor: number;
  /** Last completed daily session used to anchor the forecast base price. */
  base_session_date?: string;
  as_of_utc: string;
  market_session_phase: string;
  prev_close: number | null;
  premarket_open_4am: number | null;
  /** Opening window (see src/constants/premarketWindow.ts); fully elapsed at report time. */
  premarket_window_start_et?: string;
  premarket_window_end_et?: string;
  premarket_window_high?: number | null;
  premarket_window_low?: number | null;
  premarket_window_change_pct?: number | null;
  premarket_window_volume?: number | null;
  /** @deprecated Legacy 04:00-04:30 fields on records created before the window redefinition. */
  premarket_30m_high?: number | null;
  premarket_30m_low?: number | null;
  premarket_30m_change_pct?: number | null;
  premarket_30m_volume?: number | null;
  pre_market_or_latest_price: number | null;
  pre_market_change_pct: number | null;
  intraday_high: number | null;
  intraday_low: number | null;
  five_day_return_pct: number | null;
  twenty_day_return_pct: number | null;
  overnight_futures_symbol: string;
  overnight_futures_change_pct: number | null;
  /** Daily close-to-close futures return; not an overnight-only measurement. */
  futures_daily_change_pct?: number | null;
  /** Prior-session VIX close. */
  vix_level: number | null;
  /** Latest overnight VIX print (Cboe disseminates from 3:15am ET); null outside 03:15–09:30 ET. */
  vix_overnight_level: number | null;
  vxn_level: number | null;
  /** Cboe Russell 2000 volatility index close; populated for Russell 2000 profiles (TNA). */
  rvx_level: number | null;
  vix9d_level: number | null;
  vix3m_level: number | null;
  symbol_iv_pct: number | null;
  iv_rank_pct: number | null;
  put_call_ratio: number | null;
  realized_vol_20d_pct: number | null;
  us_2y_yield_pct: number | null;
  us_10y_yield_pct: number | null;
  dxy_level: number | null;
  wti_crude_usd: number | null;
  fed_watch_summary: string;
  key_headlines: string[];
  next_day_catalysts: CatalystItem[];
  missing_inputs: string[];
  confidence_score: number;
  source_coverage: SourceCoverage;
  raw_research_notes: string;
  /** Per-input source and observation time. */
  input_observations: InputObservation[];
}

export interface HorizonAuditEntry {
  horizon: HorizonKey;
  raw_prob_sum: number;
  reconciled_prob_sum: number;
  cdf_monotonic: boolean;
  quantiles_coherent: boolean;
  adjustment_applied_bp: number;
}

export interface MathAuditReport {
  audited_at: string;
  all_passed: boolean;
  strategy_weight_raw_sum: number;
  strategy_weight_reconciled_sum: number;
  horizons: HorizonAuditEntry[];
}

export interface RealizedVerification {
  verified_at: string;
  target_horizon: 'tomorrow' | 'next_week';
  actual_close_price: number;
  actual_return_pct: number;
  brier_score: number;
  within_iqr_p25_p75: boolean;
  within_90_p05_p95: boolean;
  notes: string;
  sources: GroundingSource[];
}

export interface ForecastRecord {
  id: string;
  created_at: string;
  trigger: 'manual' | 'scheduled';
  calibration_mode: CalibrationMode;
  run_window: RunWindow;
  payload: ForecastPayload;
  snapshot: MarketSnapshot;
  sources: GroundingSource[];
  audit: MathAuditReport;
  verification?: RealizedVerification;
  /** Caller-supplied key (e.g. Cloud Scheduler schedule time) used to dedupe task triggers. */
  idempotency_key?: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  time_et: string;
  trading_days_only: boolean;
  symbols: string[];
  calibration_mode: CalibrationMode;
  run_window: RunWindow;
  /** ET date of the last scheduled/external attempt (success or failure). */
  last_scheduled_run_date_et: string | null;
  last_run_status: string | null;
  /** Retries stop at this ET time; a missed-deadline alert fires once it passes. */
  retry_cutoff_et: string;
  /** ET date on which every symbol had a validated record. */
  last_successful_run_date_et: string | null;
  attempts_date_et: string | null;
  attempts_today: number;
  last_attempt_at: string | null;
  missed_alert_date_et: string | null;
  config_version: number;
}
