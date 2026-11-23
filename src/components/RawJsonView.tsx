import React, { useState } from 'react';
import { Check, CheckCircle2, Copy, Download, AlertTriangle } from 'lucide-react';
import type { ForecastRecord } from '../types/forecast';

interface RawJsonViewProps {
  activeRecord: ForecastRecord | null;
  onRunForecast: () => void;
}

export const RawJsonView: React.FC<RawJsonViewProps> = ({ activeRecord, onRunForecast }) => {
  const [copied, setCopied] = useState(false);

  if (!activeRecord) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">No Audited JSON Payload Loaded</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Run a live forecast to inspect the strictly audited Schema v1.1.0 JSON payload and Step 5 mathematical verification ledger.
        </p>
        <button
          type="button"
          onClick={onRunForecast}
          className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors"
        >
          Run Live Forecast
        </button>
      </div>
    );
  }

  const jsonString = JSON.stringify(activeRecord.payload, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeRecord.payload.symbol.toLowerCase()}-${activeRecord.payload.as_of.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { audit } = activeRecord;

  return (
    <div className="space-y-6">
      {/* Step 5 Math Audit Ledger */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Step 5 Deterministic Mathematical Audit Ledger
            </h1>
            <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
              Audited at {audit.audited_at} · Strategy Weight Sum: {audit.strategy_weight_raw_sum.toFixed(2)} →{' '}
              {audit.strategy_weight_reconciled_sum.toFixed(2)}
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium">
            {audit.all_passed ? (
              <span className="text-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                All Invariants Verified
              </span>
            ) : (
              <span className="text-amber-700 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Check Applied Adjustments
              </span>
            )}
          </div>
        </div>

        <div className="border border-slate-200 rounded-md overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr className="h-9">
                <th className="px-4 text-left font-medium">Horizon</th>
                <th className="px-4 text-right font-medium">Raw Sum</th>
                <th className="px-4 text-right font-medium">Audited Sum</th>
                <th className="px-4 text-right font-medium">Reconciliation (bp)</th>
                <th className="px-4 text-center font-medium">CDF Monotonic</th>
                <th className="px-4 text-center font-medium">Quantile Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {audit.horizons.map((h) => (
                <tr key={h.horizon} className="h-9">
                  <td className="px-4 font-mono font-medium text-slate-900">{h.horizon}</td>
                  <td className="px-4 text-right font-mono tabular-nums text-slate-600">
                    {h.raw_prob_sum.toFixed(4)}
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                    {h.reconciled_prob_sum.toFixed(4)}
                  </td>
                  <td className="px-4 text-right font-mono tabular-nums text-slate-700">
                    {h.adjustment_applied_bp >= 0 ? `+${h.adjustment_applied_bp}` : h.adjustment_applied_bp}
                  </td>
                  <td className="px-4 text-center font-medium text-emerald-700">
                    {h.cdf_monotonic ? 'Pass' : 'Fail'}
                  </td>
                  <td className="px-4 text-center font-medium text-emerald-700">
                    {h.quantiles_coherent ? 'Pass' : 'Fail'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Strict Raw JSON Output */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Schema v{activeRecord.payload.schema_version} JSON Output
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {activeRecord.payload.symbol} · {activeRecord.payload.model}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Download .json
            </button>
          </div>
        </div>

        <pre className="p-4 bg-slate-950 text-slate-100 rounded-md text-xs leading-relaxed overflow-x-auto max-h-[640px] font-mono">
          {jsonString}
        </pre>
      </section>
    </div>
  );
};
