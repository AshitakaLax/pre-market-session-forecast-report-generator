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
  premarket_30m_high: number | null;
  premarket_30m_low: number | null;
  premarket_30m_change_pct: number | null;
  premarket_30m_volume: number | null;
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
  vix_level: number | null;
  vxn_level: number | null;
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
}

export interface ScheduleConfig {
  enabled: boolean;
  time_et: string;
  trading_days_only: boolean;
  symbols: string[];
  calibration_mode: CalibrationMode;
  run_window: RunWindow;
  last_scheduled_run_date_et: string | null;
  last_run_status: string | null;
}
