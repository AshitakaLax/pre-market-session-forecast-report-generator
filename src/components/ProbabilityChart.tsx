import React, { useState } from 'react';
import type { HorizonForecast } from '../types/forecast';

interface ProbabilityChartProps {
  horizon: HorizonForecast;
  basePrice: number;
}

interface ChartColumn {
  id: string;
  label: string;
  rangeLabel: string;
  prob: number;
  cdf: number;
  isPositive: boolean;
  isTail: boolean;
  minPct: number | null;
  maxPct: number | null;
}

export const ProbabilityChart: React.FC<ProbabilityChartProps> = ({ horizon, basePrice }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showCdf, setShowCdf] = useState<boolean>(true);

  const firstMin = horizon.bins[0]?.min_pct ?? -2.5;
  const lastMax = horizon.bins[horizon.bins.length - 1]?.max_pct ?? 2.5;

  const columns: ChartColumn[] = [
    {
      id: 'underflow',
      label: `<${firstMin}%`,
      rangeLabel: `< ${firstMin.toFixed(1)}%`,
      prob: horizon.underflow_prob,
      cdf: horizon.underflow_prob,
      isPositive: false,
      isTail: true,
      minPct: null,
      maxPct: firstMin,
    },
    ...horizon.bins.map((b, i) => ({
      id: `bin-${i}`,
      label: `${b.min_pct >= 0 ? '+' : ''}${b.min_pct}%`,
      rangeLabel: `${b.min_pct >= 0 ? '+' : ''}${b.min_pct.toFixed(1)}% to ${b.max_pct >= 0 ? '+' : ''}${b.max_pct.toFixed(1)}%`,
      prob: b.prob,
      cdf: b.cdf,
      isPositive: (b.min_pct + b.max_pct) / 2 >= 0,
      isTail: false,
      minPct: b.min_pct,
      maxPct: b.max_pct,
    })),
    {
      id: 'overflow',
      label: `>${lastMax}%`,
      rangeLabel: `> +${lastMax.toFixed(1)}%`,
      prob: horizon.overflow_prob,
      cdf: 1,
      isPositive: true,
      isTail: true,
      minPct: lastMax,
      maxPct: null,
    },
  ];

  const maxProb = Math.max(0.15, ...columns.map((c) => c.prob)) * 1.18;
  const svgW = 860;
  const svgH = 310;
  const padL = 48;
  const padR = 48;
  const padT = 26;
  const padB = 46;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const colW = plotW / columns.length;
  const barGap = 8;
  const barW = Math.max(12, colW - barGap);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    prob: frac * maxProb,
    y: padT + plotH * (1 - frac),
    cdfPct: Math.round(frac * 100),
  }));

  // Breakeven line sits between bin 4 (-w..0) and bin 5 (0..+w), i.e. boundary index 6 (underflow + 5 neg bins)
  const zeroLineX = padL + 6 * colW;

  const cdfPoints = columns
    .map((col, idx) => {
      const cx = padL + idx * colW + colW / 2;
      const cy = padT + plotH * (1 - col.cdf);
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    })
    .join(' ');

  const hovered = hoveredIdx !== null ? columns[hoveredIdx] : null;

  const formatTargetPrice = (pct: number | null) => {
    if (pct === null || !basePrice || basePrice <= 0) return null;
    return `$${(basePrice * (1 + pct / 100)).toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 bg-red-600/80 inline-block" />
            Negative Return Mass
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 bg-emerald-600/85 inline-block" />
            Positive Return Mass
          </span>
          {showCdf && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-slate-900 inline-block" />
              Cumulative CDF
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowCdf((prev) => !prev)}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          {showCdf ? 'Hide CDF Curve' : 'Show CDF Curve'}
        </button>
      </div>

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto select-none overflow-visible"
          role="img"
          aria-label={`Probability distribution chart for ${horizon.label}`}
        >
          {/* Horizontal gridlines */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL}
                y1={t.y}
                x2={svgW - padR}
                y2={t.y}
                stroke="#E2E8F0"
                strokeWidth="1"
                strokeDasharray={i === 0 ? undefined : '3 3'}
              />
              <text
                x={padL - 8}
                y={t.y + 4}
                textAnchor="end"
                className="fill-slate-500 text-[11px] font-mono tabular-nums"
              >
                {(t.prob * 100).toFixed(0)}%
              </text>
              {showCdf && (
                <text
                  x={svgW - padR + 8}
                  y={t.y + 4}
                  textAnchor="start"
                  className="fill-slate-400 text-[11px] font-mono tabular-nums"
                >
                  {t.cdfPct}%
                </text>
              )}
            </g>
          ))}

          {/* 0.0% Breakeven vertical axis */}
          <line
            x1={zeroLineX}
            y1={padT - 6}
            x2={zeroLineX}
            y2={padT + plotH}
            stroke="#64748B"
            strokeWidth="1.25"
            strokeDasharray="4 3"
          />
          <text
            x={zeroLineX}
            y={padT - 10}
            textAnchor="middle"
            className="fill-slate-600 text-[10px] font-mono font-medium"
          >
            0.0%
          </text>

          {/* Bars */}
          {columns.map((col, idx) => {
            const x = padL + idx * colW + barGap / 2;
            const barH = Math.max(2, (col.prob / maxProb) * plotH);
            const y = padT + plotH - barH;
            const isHovered = hoveredIdx === idx;
            const fill = col.isPositive
              ? col.isTail
                ? '#15803D'
                : '#16A34A'
              : col.isTail
                ? '#B91C1C'
                : '#DC2626';

            return (
              <g
                key={col.id}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <rect
                  x={x}
                  y={padT}
                  width={barW}
                  height={plotH}
                  fill={isHovered ? 'rgba(15, 23, 42, 0.04)' : 'transparent'}
                />
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={2}
                  fill={fill}
                  fillOpacity={col.isTail ? (isHovered ? 0.9 : 0.65) : isHovered ? 1 : 0.85}
                />
                <text
                  x={x + barW / 2}
                  y={y - 5}
                  textAnchor="middle"
                  className="fill-slate-700 text-[10px] font-mono tabular-nums"
                >
                  {(col.prob * 100).toFixed(1)}%
                </text>
                <text
                  x={x + barW / 2}
                  y={padT + plotH + 18}
                  textAnchor="middle"
                  className={`text-[10px] font-mono tabular-nums ${
                    col.isTail ? 'fill-slate-700 font-semibold' : 'fill-slate-500'
                  }`}
                >
                  {col.label}
                </text>
              </g>
            );
          })}

          {/* Cumulative CDF overlay */}
          {showCdf && (
            <g className="pointer-events-none">
              <polyline
                fill="none"
                stroke="#0F172A"
                strokeWidth="2"
                strokeLinejoin="round"
                points={cdfPoints}
              />
              {columns.map((col, idx) => {
                const cx = padL + idx * colW + colW / 2;
                const cy = padT + plotH * (1 - col.cdf);
                return (
                  <circle
                    key={`cdf-${col.id}`}
                    cx={cx}
                    cy={cy}
                    r={hoveredIdx === idx ? 4.5 : 2.5}
                    fill="#0F172A"
                  />
                );
              })}
            </g>
          )}
        </svg>

        {/* Inspection bar below chart */}
        <div className="mt-2 min-h-[36px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center justify-between gap-4 text-xs">
          {hovered ? (
            <>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900 font-mono tabular-nums">
                  Interval: {hovered.rangeLabel}
                </span>
                {basePrice > 0 && (
                  <span className="text-slate-600 font-mono tabular-nums">
                    Price Target:{' '}
                    {hovered.minPct === null
                      ? `< ${formatTargetPrice(hovered.maxPct)}`
                      : hovered.maxPct === null
                        ? `> ${formatTargetPrice(hovered.minPct)}`
                        : `${formatTargetPrice(hovered.minPct)} – ${formatTargetPrice(hovered.maxPct)}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 font-mono tabular-nums">
                <span className="text-slate-700">
                  Bin Prob: <strong className="text-slate-900">{(hovered.prob * 100).toFixed(2)}%</strong>
                </span>
                <span className="text-slate-700">
                  Cumulative CDF: <strong className="text-slate-900">{(hovered.cdf * 100).toFixed(2)}%</strong>
                </span>
              </div>
            </>
          ) : (
            <span className="text-slate-500">
              Hover over any return bin or tail bucket to inspect exact probability mass, cumulative CDF, and implied price range.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
