import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, CheckCircle2, RefreshCw, Clock, Save, Copy, Check } from 'lucide-react';
import type {
  CalibrationMode,
  ForecastRecord,
  RunWindow,
  ScheduleConfig,
} from '../types/forecast';

interface ScheduleHistoryViewProps {
  forecasts: ForecastRecord[];
  activeRecordId: string | null;
  onSelectForecast: (record: ForecastRecord) => void;
  onDeleteForecast: (id: string) => Promise<void>;
  onVerifyForecast: (id: string) => Promise<void>;
  verifyingId: string | null;
  schedule: ScheduleConfig | null;
  easternClock: {
    dateEt: string;
    timeEt: string;
    weekday: string;
    isTradingDay: boolean;
  } | null;
  onSaveSchedule: (next: ScheduleConfig) => Promise<void>;
}

export const ScheduleHistoryView: React.FC<ScheduleHistoryViewProps> = ({
  forecasts,
  activeRecordId,
  onSelectForecast,
  onDeleteForecast,
  onVerifyForecast,
  verifyingId,
  schedule,
  easternClock,
  onSaveSchedule,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [timeEt, setTimeEt] = useState('04:30');
  const [tradingDaysOnly, setTradingDaysOnly] = useState(true);
  const [symbolsInput, setSymbolsInput] = useState('TQQQ');
  const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>('leveraged_scaled');
  const [runWindow, setRunWindow] = useState<RunWindow>('pre_market');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const taskEndpointUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/tasks/premarket`
      : '/api/tasks/premarket';

  const curlSnippet = `curl -X POST "${taskEndpointUrl}" -H "Content-Type: application/json" -d '{"symbols":["TQQQ"]}'`;

  const handleCopyCurl = async () => {
    await navigator.clipboard.writeText(curlSnippet);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1800);
  };

  useEffect(() => {
    if (!schedule) return;
    setEnabled(schedule.enabled);
    setTimeEt(schedule.time_et);
    setTradingDaysOnly(schedule.trading_days_only);
    setSymbolsInput(schedule.symbols.join(', '));
    setCalibrationMode(schedule.calibration_mode);
    setRunWindow(schedule.run_window);
  }, [schedule]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveNotice(null);
    const symbols = symbolsInput
      .split(',')
      .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, ''))
      .filter(Boolean);

    try {
      await onSaveSchedule({
        enabled,
        time_et: timeEt,
        trading_days_only: tradingDaysOnly,
        symbols: symbols.length > 0 ? symbols : ['TQQQ'],
        calibration_mode: calibrationMode,
        run_window: runWindow,
        last_scheduled_run_date_et: schedule?.last_scheduled_run_date_et ?? null,
        last_run_status: schedule?.last_run_status ?? null,
      });
      setSaveNotice('Pre-market schedule updated.');
      setTimeout(() => setSaveNotice(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  const uniqueSymbols = useMemo(() => {
    const set = new Set(forecasts.map((f) => f.payload.symbol));
    return ['ALL', ...Array.from(set)];
  }, [forecasts]);

  const filteredForecasts = useMemo(() => {
    if (symbolFilter === 'ALL') return forecasts;
    return forecasts.filter((f) => f.payload.symbol === symbolFilter);
  }, [forecasts, symbolFilter]);

  const verifiedStats = useMemo(() => {
    const verified = forecasts.filter((f) => f.verification);
    if (verified.length === 0) return null;
    const avgBrier =
      verified.reduce((acc, f) => acc + (f.verification?.brier_score ?? 0), 0) / verified.length;
    const iqrHits = verified.filter((f) => f.verification?.within_iqr_p25_p75).length;
    const p90Hits = verified.filter((f) => f.verification?.within_90_p05_p95).length;
    return {
      count: verified.length,
      avgBrier,
      iqrRate: (iqrHits / verified.length) * 100,
      p90Rate: (p90Hits / verified.length) * 100,
    };
  }, [forecasts]);

  const handleVerifyClick = async (id: string) => {
    setVerifyError(null);
    try {
      await onVerifyForecast(id);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to verify realized outcome yet.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Automated Pre-Market Morning Scheduler */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Daily Pre-Market Morning Automation
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Runs after the first 30 minutes of pre-market trading (04:00–04:30 ET) so your rest-of-day forecast is ready before 05:00 ET.
            </p>
          </div>

          {easternClock && (
            <div className="text-xs text-slate-600 font-mono tabular-nums flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              <span>
                New York: {easternClock.dateEt} ({easternClock.weekday}) {easternClock.timeEt} ET
              </span>
              <span aria-hidden="true">·</span>
              <span className={easternClock.isTradingDay ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                {easternClock.isTradingDay ? 'Trading Day' : 'Market Closed'}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-12 gap-5 items-end">
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">Scheduler State</label>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setEnabled(true)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  enabled ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Enabled
              </button>
              <button
                type="button"
                onClick={() => setEnabled(false)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  !enabled ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Paused
              </button>
            </div>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label htmlFor="sched-time" className="block text-xs font-medium text-slate-700">
              Trigger Time (ET)
            </label>
            <input
              id="sched-time"
              type="time"
              value={timeEt}
              onChange={(e) => setTimeEt(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label htmlFor="sched-symbols" className="block text-xs font-medium text-slate-700">
              Symbols (comma-separated)
            </label>
            <input
              id="sched-symbols"
              type="text"
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              placeholder="TQQQ, QQQ"
              className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">Market Calendar</label>
            <button
              type="button"
              onClick={() => setTradingDaysOnly((v) => !v)}
              className={`w-full px-3 py-1.5 text-xs font-medium rounded-md border transition-colors text-left ${
                tradingDaysOnly
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tradingDaysOnly ? 'Trading Days Only' : 'Every Calendar Day'}
            </button>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200 text-xs text-slate-500">
          <div>
            Recommended trigger: <span className="font-mono text-slate-700">04:30 ET</span> (captures 04:00–04:30 ET opening pre-market price discovery before 05:00 ET trading) or <span className="font-mono text-slate-700">08:35 ET</span> (post-08:30 ET macro prints).
          </div>
          {saveNotice && (
            <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {saveNotice}
            </span>
          )}
          {schedule?.last_run_status && !saveNotice && (
            <span className="font-mono text-slate-600">
              Last batch: {schedule.last_run_status}
            </span>
          )}
        </div>
      </section>

      {/* External Task Automation (Cloud Scheduler / GitHub Actions / Cron) */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              External Scheduled Task Trigger (04:30 ET)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Trigger your deployed app headlessly via Cloud Scheduler, GitHub Actions, or crontab so morning runs execute even when your browser is closed. Uses the billing-enabled API key attached in Settings &gt; Secrets.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyCurl}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {copiedCurl ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedCurl ? 'Copied' : 'Copy Webhook Command'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
          <div className="lg:col-span-7 space-y-1.5">
            <div className="font-medium text-slate-700">HTTP POST Endpoint</div>
            <pre className="p-3 bg-slate-950 text-slate-100 rounded-md overflow-x-auto font-mono">
              {curlSnippet}
            </pre>
          </div>
          <div className="lg:col-span-5 space-y-1.5">
            <div className="font-medium text-slate-700">Weekday 04:30 ET Cron Expression</div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 font-mono text-slate-800">
              <div>30 4 * * 1-5  (TZ: America/New_York)</div>
              <div className="font-sans text-slate-600">
                Automatically skips US market holidays unless <code className="font-mono">force: true</code> is passed. Add <code className="font-mono">CRON_SECRET</code> in Secrets to require a Bearer token.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Forecast Archive & Realized Calibration */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Forecast Archive & Out-of-Sample Calibration
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Compare stored morning forecasts against realized market closes using Brier Score and interval hit rates.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            {uniqueSymbols.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setSymbolFilter(sym)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors font-mono whitespace-nowrap shrink-0 ${
                  symbolFilter === sym
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {verifiedStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 border border-slate-200 rounded-md divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Verified Runs</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {verifiedStats.count}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Mean Brier Score (1D)</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {verifiedStats.avgBrier.toFixed(4)}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">p25–p75 IQR Hit Rate</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {verifiedStats.iqrRate.toFixed(0)}%
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">p05–p95 90% Coverage</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {verifiedStats.p90Rate.toFixed(0)}%
              </div>
            </div>
          </div>
        )}

        {verifyError && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {verifyError}
          </div>
        )}

        {filteredForecasts.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No forecast runs archived yet. Run a live forecast from the Forecast tab or enable the morning scheduler above.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr className="h-10">
                  <th className="px-3 text-left font-medium">As-Of (UTC)</th>
                  <th className="px-3 text-left font-medium">Symbol</th>
                  <th className="px-3 text-left font-medium">Trigger</th>
                  <th className="px-3 text-right font-medium">Base Price</th>
                  <th className="px-3 text-right font-medium">1D Mean</th>
                  <th className="px-3 text-right font-medium">P(&gt;0%)</th>
                  <th className="px-3 text-right font-medium">Realized 1D & Brier</th>
                  <th className="px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredForecasts.map((rec) => {
                  const isActive = rec.id === activeRecordId;
                  const tmrw = rec.payload.horizons.tomorrow;
                  return (
                    <tr
                      key={rec.id}
                      className={`h-11 transition-colors ${
                        isActive ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {rec.payload.as_of.replace('T', ' ').slice(0, 16)}
                      </td>
                      <td className="px-3 font-mono font-semibold text-slate-900">
                        {rec.payload.symbol}
                      </td>
                      <td className="px-3 text-slate-600 capitalize">{rec.trigger}</td>
                      <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                        ${rec.payload.base_price.toFixed(2)}
                      </td>
                      <td
                        className={`px-3 text-right font-mono tabular-nums font-medium ${
                          tmrw.summary.mean_pct >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {tmrw.summary.mean_pct >= 0 ? '+' : ''}
                        {tmrw.summary.mean_pct.toFixed(2)}%
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums text-slate-900">
                        {(tmrw.summary.prob_positive * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {rec.verification ? (
                          <span className="text-slate-900">
                            <span
                              className={
                                rec.verification.actual_return_pct >= 0
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-red-700 font-semibold'
                              }
                            >
                              {rec.verification.actual_return_pct >= 0 ? '+' : ''}
                              {rec.verification.actual_return_pct.toFixed(2)}%
                            </span>
                            {' · Brier '}
                            {rec.verification.brier_score.toFixed(3)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={verifyingId === rec.id}
                            onClick={() => handleVerifyClick(rec.id)}
                            className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-sans font-medium disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${verifyingId === rec.id ? 'animate-spin' : ''}`}
                            />
                            {verifyingId === rec.id ? 'Checking...' : 'Verify Close'}
                          </button>
                        )}
                      </td>
                      <td className="px-3 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => onSelectForecast(rec)}
                          className="text-xs font-medium text-slate-900 hover:text-blue-700"
                        >
                          {isActive ? 'Viewing' : 'Inspect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteForecast(rec.id)}
                          aria-label={`Delete forecast ${rec.payload.symbol} ${rec.payload.as_of}`}
                          className="inline-flex items-center text-slate-400 hover:text-red-600 align-middle"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
