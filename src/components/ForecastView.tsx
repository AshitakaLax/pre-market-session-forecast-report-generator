import React, { useState } from 'react';
import { ExternalLink, Play, AlertCircle, CheckCircle2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type {
  CalibrationMode,
  ForecastRecord,
  HorizonKey,
  RunWindow,
} from '../types/forecast';
import { ProbabilityChart } from './ProbabilityChart';

interface ForecastViewProps {
  activeRecord: ForecastRecord | null;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  calibrationMode: CalibrationMode;
  onCalibrationModeChange: (mode: CalibrationMode) => void;
  runWindow: RunWindow;
  onRunWindowChange: (win: RunWindow) => void;
  isRunning: boolean;
  progressMessage: string | null;
  errorMessage: string | null;
  onRunForecast: () => void;
  onOpenOptimizer: () => void;
}

const PRESET_SYMBOLS = ['TQQQ', 'QQQ', 'SPY', 'SOXL', 'NVDA'];

const HORIZON_TABS: Array<{ key: HorizonKey; shortLabel: string }> = [
  { key: 'tomorrow', shortLabel: 'Tomorrow (1D)' },
  { key: 'next_week', shortLabel: 'Next Week (5D)' },
  { key: 'next_month', shortLabel: 'Next Month (21D)' },
  { key: 'next_quarter', shortLabel: 'Next Quarter (63D)' },
  { key: 'next_year', shortLabel: 'Next Year (252D)' },
];

function formatRegime(regime: string): string {
  return regime
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatNum(val: number | null | undefined, suffix = '', decimals = 2): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/A';
  return `${val.toFixed(decimals)}${suffix}`;
}

export const ForecastView: React.FC<ForecastViewProps> = ({
  activeRecord,
  symbol,
  onSymbolChange,
  calibrationMode,
  onCalibrationModeChange,
  runWindow,
  onRunWindowChange,
  isRunning,
  progressMessage,
  errorMessage,
  onRunForecast,
  onOpenOptimizer,
}) => {
  const [selectedHorizon, setSelectedHorizon] = useState<HorizonKey>('tomorrow');
  const [customTicker, setCustomTicker] = useState<string>('');

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customTicker.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '');
    if (cleaned) {
      onSymbolChange(cleaned);
      setCustomTicker('');
    }
  };

  const payload = activeRecord?.payload;
  const snapshot = activeRecord?.snapshot;
  const horizonData = payload?.horizons?.[selectedHorizon];

  return (
    <div className="space-y-6">
      {/* Workspace Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {PRESET_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => onSymbolChange(sym)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 font-mono ${
                  symbol === sym
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>

          <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5">
            <input
              type="text"
              value={customTicker}
              onChange={(e) => setCustomTicker(e.target.value)}
              placeholder="Other ticker"
              aria-label="Custom ticker symbol"
              className="w-28 px-2.5 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Set
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => onRunWindowChange('pre_market')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                runWindow === 'pre_market'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pre-Market (04:30 ET)
            </button>
            <button
              type="button"
              onClick={() => onRunWindowChange('pre_bell')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                runWindow === 'pre_bell'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pre-Bell (08:30 ET)
            </button>
            <button
              type="button"
              onClick={() => onRunWindowChange('eod')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                runWindow === 'eod'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EOD Close
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => onCalibrationModeChange('leveraged_scaled')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                calibrationMode === 'leveraged_scaled'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Volatility-Scaled Bins
            </button>
            <button
              type="button"
              onClick={() => onCalibrationModeChange('original_1x')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                calibrationMode === 'original_1x'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Fixed 1x Schema
            </button>
          </div>
        </div>
      </div>

      {/* Live execution status */}
      {isRunning && (
        <div className="bg-white border border-blue-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-slate-800 font-medium">
              {progressMessage || `Executing 5-stage grounded pipeline for ${symbol}...`}
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 whitespace-nowrap shrink-0">
            Active Grounding
          </span>
        </div>
      )}

      {/* Error alert */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm text-red-900">{errorMessage}</div>
        </div>
      )}

      {/* Empty State */}
      {!activeRecord && !isRunning && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 md:p-12">
          <div className="max-w-2xl space-y-5">
            <div className="text-xs text-slate-500 font-medium">
              Target: {symbol} · Pipeline: 5-Stage Grounded Pre-Market Engine
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight text-balance">
              Generate an audited pre-market probabilistic forecast for {symbol}
            </h1>
            <p className="text-sm md:text-base text-slate-600 leading-relaxed">
              This workbench executes live multi-source web retrieval across primary exchange, Cboe volatility (VXN/VIX), CME futures (NQ=F), US Treasury yields, and scheduled macro calendars—followed by deterministic Step 5 mathematical verification.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onRunForecast}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" />
                Run Live Forecast ({symbol})
              </button>
              <button
                type="button"
                onClick={onOpenOptimizer}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                View Model & Data Setup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Populated Forecast Workspace */}
      {activeRecord && payload && snapshot && horizonData && (
        <>
          {/* Unboxed Metadata Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="text-sm font-semibold text-slate-900 font-mono">{payload.symbol}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">As of {payload.as_of}</span>
              <span aria-hidden="true">·</span>
              <span>
                Coverage:{' '}
                <strong className="font-medium text-slate-900">
                  {formatRegime(payload.execution_signals.data_quality.source_coverage)}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Input coverage: {(payload.execution_signals.data_quality.confidence_score * 100).toFixed(0)}%
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {activeRecord.audit.all_passed ? 'Step 5 Audit Passed' : 'Reconciled'}
              </span>
            </div>

            <div className="text-xs text-slate-500 font-mono">
              {activeRecord.calibration_mode === 'leveraged_scaled'
                ? `${snapshot.leverage_factor}x Leveraged Bin Calibration`
                : 'Fixed 1x Schema Calibration'}
            </div>
          </div>

          {snapshot.source_coverage === 'degraded' && (
            <div
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <strong>Market-data coverage is degraded.</strong> Some history or covariates were
              unavailable, so this forecast uses a reduced input set. Kelly sizing is disabled
              until walk-forward calibration is completed. Review the missing inputs before relying
              on the distribution.
            </div>
          )}

          {/* 4-Column Signal Strip */}
          <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-4 space-y-1">
              <div className="text-xs text-slate-500">Base Reference Price</div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                  {payload.base_price > 0 ? '$' + payload.base_price.toFixed(2) : 'Unavailable'}
                </span>
                {snapshot.pre_market_change_pct !== null && (
                  <span
                    className={`inline-flex items-center text-xs font-mono tabular-nums font-medium ${
                      snapshot.pre_market_change_pct >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {snapshot.pre_market_change_pct >= 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    {snapshot.pre_market_change_pct >= 0 ? '+' : ''}
                    {snapshot.pre_market_change_pct.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {snapshot.overnight_futures_symbol}:{' '}
                {snapshot.overnight_futures_change_pct !== null
                  ? `${snapshot.overnight_futures_change_pct >= 0 ? '+' : ''}${snapshot.overnight_futures_change_pct.toFixed(2)}%`
                  : 'N/A'}
                {' · '}Prev Close: {snapshot.prev_close ? `$${snapshot.prev_close.toFixed(2)}` : 'N/A'}
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-xs text-slate-500">Expected 1D Move & Vol State</div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                  ±{payload.execution_signals.expected_1d_move_pct.toFixed(2)}%
                </span>
                <span className="text-xs font-medium text-slate-700">
                  {formatRegime(payload.execution_signals.volatility_state)}
                </span>
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                IV-RV Spread:{' '}
                {payload.execution_signals.implied_vs_realized_vol_spread_pct >= 0 ? '+' : ''}
                {payload.execution_signals.implied_vs_realized_vol_spread_pct.toFixed(2)}%
                {snapshot.vxn_level ? ` · VXN ${snapshot.vxn_level.toFixed(1)}` : ''}
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-xs text-slate-500">Regime & Tail Posture</div>
              <div className="text-lg font-semibold text-slate-900 truncate">
                {formatRegime(payload.execution_signals.regime)}
              </div>
              <div className="text-xs text-slate-500">
                Skew: <span className="text-slate-800 font-medium">{formatRegime(payload.execution_signals.skew_bias)}</span>
                {' · '}
                Gap Risk:{' '}
                <span
                  className={`font-medium ${
                    payload.execution_signals.overnight_gap_risk === 'high'
                      ? 'text-red-700'
                      : payload.execution_signals.overnight_gap_risk === 'moderate'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {formatRegime(payload.execution_signals.overnight_gap_risk)}
                </span>
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-xs text-slate-500">Fractional Kelly Cap</div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                  {(payload.execution_signals.kelly_fraction_cap * 100).toFixed(0)}%
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  ({payload.execution_signals.kelly_fraction_cap.toFixed(2)})
                </span>
              </div>
              <div className="text-xs text-slate-500 truncate">
                Top Weight:{' '}
                {(() => {
                  const entries = Object.entries(
                    payload.execution_signals.suggested_strategy_weights
                  ).sort((a, b) => b[1] - a[1]);
                  return `${formatRegime(entries[0][0])} (${(entries[0][1] * 100).toFixed(0)}%)`;
                })()}
              </div>
            </div>
          </div>

          {/* Dominant Focal Anchor: Multi-Horizon Probability Distribution */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {horizonData.label} Return Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {horizonData.trading_days} trading {horizonData.trading_days === 1 ? 'day' : 'days'} · Bin width {horizonData.bin_width_pct.toFixed(1)}% · Underflow {(horizonData.underflow_prob * 100).toFixed(2)}% · Overflow {(horizonData.overflow_prob * 100).toFixed(2)}%
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
                {HORIZON_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedHorizon(tab.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      selectedHorizon === tab.key
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              <div className="xl:col-span-8">
                <ProbabilityChart horizon={horizonData} basePrice={payload.base_price} />
              </div>

              <div className="xl:col-span-4 border border-slate-200 rounded-md overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Distribution Moments & Quantiles
                  </span>
                  <span className="text-xs font-mono text-slate-500">Simple %</span>
                </div>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-200">
                    <tr className="h-9">
                      <td className="px-4 text-slate-600">Expected Mean</td>
                      <td
                        className={`px-4 text-right font-mono tabular-nums font-semibold ${
                          horizonData.summary.mean_pct >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {horizonData.summary.mean_pct >= 0 ? '+' : ''}
                        {horizonData.summary.mean_pct.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9">
                      <td className="px-4 text-slate-600">Median (p50)</td>
                      <td className="px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        {horizonData.summary.median_pct >= 0 ? '+' : ''}
                        {horizonData.summary.median_pct.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9">
                      <td className="px-4 text-slate-600">Standard Deviation</td>
                      <td className="px-4 text-right font-mono tabular-nums text-slate-900">
                        {horizonData.summary.std_pct.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9">
                      <td className="px-4 text-slate-600">Prob(&gt; 0.0%)</td>
                      <td className="px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {(horizonData.summary.prob_positive * 100).toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9">
                      <td className="px-4 text-slate-600">Expected Shortfall (5%)</td>
                      <td className="px-4 text-right font-mono tabular-nums font-semibold text-red-700">
                        {horizonData.summary.expected_shortfall_5pct.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9 bg-slate-50/70">
                      <td className="px-4 text-slate-600">p01 / p05 Tail</td>
                      <td className="px-4 text-right font-mono tabular-nums text-red-700">
                        {horizonData.summary.quantiles_pct.p01.toFixed(2)}% /{' '}
                        {horizonData.summary.quantiles_pct.p05.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9 bg-slate-50/70">
                      <td className="px-4 text-slate-600">p25 / p75 IQR</td>
                      <td className="px-4 text-right font-mono tabular-nums text-slate-900">
                        {horizonData.summary.quantiles_pct.p25.toFixed(2)}% /{' '}
                        {horizonData.summary.quantiles_pct.p75 >= 0 ? '+' : ''}
                        {horizonData.summary.quantiles_pct.p75.toFixed(2)}%
                      </td>
                    </tr>
                    <tr className="h-9 bg-slate-50/70">
                      <td className="px-4 text-slate-600">p95 / p99 Upside</td>
                      <td className="px-4 text-right font-mono tabular-nums text-emerald-700">
                        +{horizonData.summary.quantiles_pct.p95.toFixed(2)}% / +
                        {horizonData.summary.quantiles_pct.p99.toFixed(2)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Lower 2-Column Analytical Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Strategy Allocation + Catalysts */}
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">
                    Suggested Strategy Allocation
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    Sum: 1.00
                  </span>
                </div>

                <div className="space-y-3">
                  {(
                    [
                      ['momentum_trend', 'Momentum / Trend Following', 'bg-blue-600'],
                      ['mean_reversion', 'Mean Reversion', 'bg-slate-700'],
                      ['volatility_harvesting', 'Volatility Harvesting', 'bg-amber-600'],
                      ['cash_defensive', 'Cash / Defensive Reserve', 'bg-slate-400'],
                    ] as const
                  ).map(([key, label, barColor]) => {
                    const weight = payload.execution_signals.suggested_strategy_weights[key];
                    const pct = Math.round(weight * 100);
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-700 font-medium">{label}</span>
                          <span className="font-mono tabular-nums text-slate-900 font-semibold">
                            {pct}% ({weight.toFixed(2)})
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
                          <div
                            className={`h-full ${barColor} transition-all duration-200`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-900">
                  Scheduled Catalysts (Next 24h–5D)
                </h3>
                {payload.execution_signals.next_day_catalysts.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No high-impact scheduled macro or constituent earnings catalysts retrieved for this window.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr className="h-9">
                          <th className="px-3 text-left font-medium">UTC</th>
                          <th className="px-3 text-left font-medium">Catalyst</th>
                          <th className="px-3 text-right font-medium">Impact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {payload.execution_signals.next_day_catalysts.map((cat, idx) => (
                          <tr key={idx} className="h-9">
                            <td className="px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {cat.time_utc}
                            </td>
                            <td className="px-3 text-slate-800">{cat.event}</td>
                            <td
                              className={`px-3 text-right font-medium capitalize whitespace-nowrap ${
                                cat.impact === 'high'
                                  ? 'text-red-700'
                                  : cat.impact === 'medium'
                                    ? 'text-amber-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {cat.impact}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Live Market State Vector & Grounding Citations */}
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-slate-900">
                  Step 1 Verified Market & Macro Vector
                </h3>
                {snapshot.raw_research_notes && (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {snapshot.raw_research_notes}
                  </p>
                )}

                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200">
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">04:00–04:30 ET Open / 30m</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {snapshot.premarket_open_4am
                            ? `$${snapshot.premarket_open_4am.toFixed(2)}`
                            : 'N/A'}{' '}
                          /{' '}
                          {snapshot.premarket_30m_change_pct !== null
                            ? `${snapshot.premarket_30m_change_pct >= 0 ? '+' : ''}${snapshot.premarket_30m_change_pct.toFixed(2)}%`
                            : 'N/A'}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">04:00–04:30 ET Range / Vol</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {snapshot.premarket_30m_low && snapshot.premarket_30m_high
                            ? `$${snapshot.premarket_30m_low.toFixed(2)}–$${snapshot.premarket_30m_high.toFixed(2)}`
                            : 'N/A'}{' '}
                          /{' '}
                          {snapshot.premarket_30m_volume !== null
                            ? snapshot.premarket_30m_volume.toLocaleString()
                            : 'N/A'}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">5D / 20D Trend</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.five_day_return_pct, '%')} /{' '}
                          {formatNum(snapshot.twenty_day_return_pct, '%')}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">Cboe VXN / VIX</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.vxn_level)} / {formatNum(snapshot.vix_level)}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">VIX9D / VIX3M Term</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.vix9d_level)} / {formatNum(snapshot.vix3m_level)}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">IV / IV Rank / Put-Call</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.symbol_iv_pct, '%')} /{' '}
                          {formatNum(snapshot.iv_rank_pct, '%', 0)} /{' '}
                          {formatNum(snapshot.put_call_ratio)}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">US 2Y / 10Y Treasury</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.us_2y_yield_pct, '%')} /{' '}
                          {formatNum(snapshot.us_10y_yield_pct, '%')}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">DXY / WTI Crude</td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                          {formatNum(snapshot.dxy_level)} /{' '}
                          {snapshot.wti_crude_usd ? `$${snapshot.wti_crude_usd.toFixed(2)}` : 'N/A'}
                        </td>
                      </tr>
                      <tr className="h-9">
                        <td className="px-3 text-slate-600">FedWatch Summary</td>
                        <td className="px-3 text-right text-slate-800 max-w-[260px] truncate">
                          {snapshot.fed_watch_summary || 'N/A'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {payload.execution_signals.data_quality.missing_inputs.length > 0 && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    Missing inputs logged (no fabrication):{' '}
                    <span className="font-mono">
                      {payload.execution_signals.data_quality.missing_inputs.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">
                    Grounded Retrieval Sources ({activeRecord.sources.length})
                  </h3>
                </div>
                {activeRecord.sources.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No external web citation URLs returned for this pass.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {activeRecord.sources.slice(0, 8).map((src, i) => (
                      <li key={i} className="px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-800 truncate">
                            {src.title}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            {src.domain}
                          </div>
                        </div>
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
