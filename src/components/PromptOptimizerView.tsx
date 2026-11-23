import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Play } from 'lucide-react';
import type { CalibrationMode, RunWindow } from '../types/forecast';
import {
  buildUpgradedPrompt,
  DIAGNOSTIC_FINDINGS,
  FINANCIAL_SOURCE_MATRIX,
} from '../utils/promptBuilder';

interface PromptOptimizerViewProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  calibrationMode: CalibrationMode;
  onCalibrationModeChange: (mode: CalibrationMode) => void;
  runWindow: RunWindow;
  onRunWindowChange: (win: RunWindow) => void;
  onRunForecast: () => void;
}

const SOURCE_CATEGORIES = [
  'All',
  'Equities & Futures',
  'Volatility & Options',
  'Macro & Rates',
  'Catalysts & Filings',
] as const;

export const PromptOptimizerView: React.FC<PromptOptimizerViewProps> = ({
  symbol,
  onSymbolChange,
  calibrationMode,
  onCalibrationModeChange,
  runWindow,
  onRunWindowChange,
  onRunForecast,
}) => {
  const [sourceFilter, setSourceFilter] = useState<(typeof SOURCE_CATEGORIES)[number]>('All');
  const [copied, setCopied] = useState(false);

  const upgradedPrompt = useMemo(
    () =>
      buildUpgradedPrompt({
        symbol,
        runWindow,
        calibrationMode,
      }),
    [symbol, runWindow, calibrationMode]
  );

  const filteredSources = useMemo(() => {
    if (sourceFilter === 'All') return FINANCIAL_SOURCE_MATRIX;
    return FINANCIAL_SOURCE_MATRIX.filter((s) => s.category === sourceFilter);
  }, [sourceFilter]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(upgradedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const blob = new Blob([upgradedPrompt], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol.toLowerCase()}-${runWindow}-forecast-prompt.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Section 1: 6 Accuracy & Repeatability Diagnostics */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-xl font-semibold text-slate-900">
            Accuracy & Repeatability Engineering Audit
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Six structural adjustments identified in your original prompt to eliminate pre-market stale-data errors, leveraged-ETF bin truncation, and LLM arithmetic drift.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {DIAGNOSTIC_FINDINGS.map((item) => (
            <div key={item.id} className="py-5 first:pt-1 last:pb-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 space-y-1">
                <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                <div
                  className={`text-xs font-medium capitalize ${
                    item.severity === 'critical'
                      ? 'text-red-700'
                      : item.severity === 'high'
                        ? 'text-amber-700'
                        : 'text-slate-600'
                  }`}
                >
                  Impact Priority: {item.severity}
                </div>
              </div>
              <div className="lg:col-span-4 space-y-1">
                <div className="text-xs font-medium text-slate-500">Original Bottleneck</div>
                <p className="text-xs text-slate-700 leading-relaxed">{item.original_issue}</p>
                <p className="text-xs text-slate-500 leading-relaxed pt-1">{item.accuracy_impact}</p>
              </div>
              <div className="lg:col-span-4 space-y-1">
                <div className="text-xs font-medium text-emerald-700">Engineered Solution</div>
                <p className="text-xs text-slate-800 leading-relaxed">{item.upgraded_fix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Tiered Primary Financial Sources */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Tiered Institutional Financial Source Matrix
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Authoritative feeds prioritized during Step 1 retrieval to prevent stale commentary and capture Nasdaq-100 microstructure.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            {SOURCE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSourceFilter(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  sourceFilter === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-slate-200 rounded-md overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr className="h-10">
                <th className="px-4 text-left font-medium">Source & Authority</th>
                <th className="px-4 text-left font-medium">Domain</th>
                <th className="px-4 text-left font-medium">Metrics Extracted</th>
                <th className="px-4 text-left font-medium">Why It Improves Accuracy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredSources.map((src) => (
                <tr key={src.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">{src.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {src.category} · {src.tier}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-slate-700 whitespace-nowrap">
                    {src.domain}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700 max-w-xs">
                    {src.metrics_extracted}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-600 max-w-sm leading-relaxed">
                    {src.accuracy_rationale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Upgraded Repeatable Prompt Export */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Upgraded Pre-Market Prompt Builder
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Customize target symbol, morning timing window, and volatility bin scaling for external automation or direct execution.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy Prompt'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export .md
            </button>
            <button
              type="button"
              onClick={onRunForecast}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              Run Live Now
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="opt-symbol" className="text-xs font-medium text-slate-700">
              Symbol
            </label>
            <input
              id="opt-symbol"
              type="text"
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
              className="w-24 px-2.5 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                ['pre_market', 'Pre-Market (04:30 ET)'],
                ['pre_bell', 'Pre-Bell (08:30 ET)'],
                ['eod', 'EOD Close'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => onRunWindowChange(val)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  runWindow === val
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => onCalibrationModeChange('leveraged_scaled')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                calibrationMode === 'leveraged_scaled'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3x Volatility-Scaled Bins
            </button>
            <button
              type="button"
              onClick={() => onCalibrationModeChange('original_1x')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                calibrationMode === 'original_1x'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Fixed 1x Schema
            </button>
          </div>
        </div>

        <pre className="p-4 bg-slate-950 text-slate-100 rounded-md text-xs leading-relaxed overflow-x-auto max-h-[520px] whitespace-pre-wrap font-mono">
          {upgradedPrompt}
        </pre>
      </section>
    </div>
  );
};
