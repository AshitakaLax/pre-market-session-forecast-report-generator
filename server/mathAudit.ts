import type {
  BinItem,
  CalibrationMode,
  ForecastPayload,
  HorizonAuditEntry,
  HorizonForecast,
  HorizonKey,
  MathAuditReport,
  StrategyWeights,
} from '../src/types/forecast.ts';

export interface HorizonSpec {
  key: HorizonKey;
  label: string;
  trading_days: number;
  base_bin_width_pct: number;
}

export const HORIZON_SPECS: HorizonSpec[] = [
  { key: 'tomorrow', label: 'Tomorrow (1D)', trading_days: 1, base_bin_width_pct: 0.5 },
  { key: 'next_week', label: 'Next Week (5D)', trading_days: 5, base_bin_width_pct: 1.0 },
  { key: 'next_month', label: 'Next Month (21D)', trading_days: 21, base_bin_width_pct: 2.0 },
  { key: 'next_quarter', label: 'Next Quarter (63D)', trading_days: 63, base_bin_width_pct: 3.0 },
  { key: 'next_year', label: 'Next Year (252D)', trading_days: 252, base_bin_width_pct: 5.0 },
];

export function buildExpectedBins(
  binWidthPct: number
): Array<{ min_pct: number; max_pct: number }> {
  const bins: Array<{ min_pct: number; max_pct: number }> = [];
  for (let i = -5; i < 5; i++) {
    bins.push({
      min_pct: Number((i * binWidthPct).toFixed(2)),
      max_pct: Number(((i + 1) * binWidthPct).toFixed(2)),
    });
  }
  return bins;
}

/**
 * Simple returns on a long position are bounded below by -100% (total loss).
 * Every simple-return value this module emits (bin edges, quantiles, moments,
 * expected shortfall) must stay at or above this floor.
 */
export const SIMPLE_RETURN_FLOOR_PCT = -100;

/**
 * Widest allowed bin. The template spans 5 bins below zero, so this keeps the
 * lowest bin edge at -95% and leaves room for the log-space underflow tail.
 */
export const MAX_BIN_WIDTH_PCT = 19;

export function getBinWidthForSymbol(
  baseWidth: number,
  leverageFactor: number,
  calibrationMode: CalibrationMode
): number {
  if (calibrationMode === 'original_1x') {
    return Math.min(baseWidth, MAX_BIN_WIDTH_PCT);
  }
  const scale = Math.max(1, leverageFactor);
  return Number(Math.min(baseWidth * scale, MAX_BIN_WIDTH_PCT).toFixed(2));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tailScaleFor(binWidthPct: number): number {
  return Math.max(binWidthPct * 0.85, 0.5);
}

/**
 * Left (underflow) tail below `firstMin`, modelled on log returns so it can
 * never cross the -100% simple-return floor.
 *
 * With U ~ Uniform(0, underflowProb] the tail is
 *   ln(1 + X/100) = ln(1 + firstMin/100) - s * ln(underflowProb / U)
 * i.e. X = (100 + firstMin) * (U / underflowProb)^s - 100, which is > -100 for
 * every U > 0. The log-space scale s = tailScale / (100 + firstMin) matches the
 * slope of the previous simple-return exponential tail at firstMin, so narrow
 * (short-horizon, unlevered) tails are practically unchanged while wide
 * leveraged tails bend towards -100% instead of passing through it.
 */
interface LeftTail {
  /** Wealth multiple at firstMin, in percent: 100 + firstMin (> 0). */
  base: number;
  /** Log-space tail scale s. */
  s: number;
}

function leftTail(firstMin: number, binWidthPct: number): LeftTail {
  const base = Math.max(1e-6, firstMin - SIMPLE_RETURN_FLOOR_PCT);
  return { base, s: tailScaleFor(binWidthPct) / base };
}

/** Quantile at relative tail rank r = U / underflowProb in (0, 1]. */
function leftTailQuantile(tail: LeftTail, r: number): number {
  return tail.base * Math.pow(r, tail.s) + SIMPLE_RETURN_FLOOR_PCT;
}

/** E[X | U / underflowProb <= c] for c in (0, 1]; c = 1 is the whole-tail mean. */
function leftTailConditionalMean(tail: LeftTail, c: number): number {
  // E[r^s | r ~ Uniform(0, c)] = c^s / (1 + s)
  return (tail.base * Math.pow(c, tail.s)) / (1 + tail.s) + SIMPLE_RETURN_FLOOR_PCT;
}

function interpolateQuantile(
  q: number,
  underflowProb: number,
  overflowProb: number,
  bins: BinItem[],
  binWidthPct: number
): number {
  const firstMin = bins[0].min_pct;
  const lastMax = bins[bins.length - 1].max_pct;

  if (q <= underflowProb) {
    if (underflowProb <= 0) return firstMin;
    // Log-space tail extension below firstMin (bounded below by -100%)
    const ratio = Math.max(1e-4, q / underflowProb);
    return leftTailQuantile(leftTail(firstMin, binWidthPct), ratio);
  }

  let prevCdf = underflowProb;
  for (const bin of bins) {
    const nextCdf = prevCdf + bin.prob;
    if (q <= nextCdf || bin.prob === 0 && q <= nextCdf + 1e-9) {
      const within = bin.prob > 0 ? (q - prevCdf) / bin.prob : 0.5;
      return bin.min_pct + within * (bin.max_pct - bin.min_pct);
    }
    prevCdf = nextCdf;
  }

  if (overflowProb <= 0) return lastMax;
  const tailScale = tailScaleFor(binWidthPct);
  const rem = Math.max(1e-4, (1 - q) / overflowProb);
  return lastMax + tailScale * Math.log(1 / rem);
}

function computeExpectedShortfall5Pct(
  underflowProb: number,
  bins: BinItem[],
  binWidthPct: number
): number {
  const alpha = 0.05;
  const firstMin = bins[0].min_pct;
  const tail = leftTail(firstMin, binWidthPct);

  if (underflowProb >= alpha) {
    // Conditional mean of the log-space left tail over U in (0, alpha]:
    // E[X | U <= alpha] = (100 + firstMin) * (alpha / underflowProb)^s / (1 + s) - 100
    return leftTailConditionalMean(tail, alpha / underflowProb);
  }

  let massAccumulated = 0;
  let weightedSum = 0;

  if (underflowProb > 0) {
    // Mean of the entire underflow tail
    weightedSum += underflowProb * leftTailConditionalMean(tail, 1);
    massAccumulated += underflowProb;
  }

  for (const bin of bins) {
    if (massAccumulated >= alpha) break;
    const needed = alpha - massAccumulated;
    if (bin.prob <= 0) continue;

    if (bin.prob <= needed) {
      const midpoint = (bin.min_pct + bin.max_pct) / 2;
      weightedSum += bin.prob * midpoint;
      massAccumulated += bin.prob;
    } else {
      const frac = needed / bin.prob;
      const upperEnd = bin.min_pct + frac * (bin.max_pct - bin.min_pct);
      const subMidpoint = (bin.min_pct + upperEnd) / 2;
      weightedSum += needed * subMidpoint;
      massAccumulated += needed;
    }
  }

  return massAccumulated > 0 ? weightedSum / massAccumulated : firstMin;
}

function reconcileHorizon(
  rawHorizon: HorizonForecast,
  spec: HorizonSpec,
  leverageFactor: number,
  calibrationMode: CalibrationMode
): { horizon: HorizonForecast; audit: HorizonAuditEntry } {
  const expectedWidth = getBinWidthForSymbol(
    spec.base_bin_width_pct,
    leverageFactor,
    calibrationMode
  );
  const templateBins = buildExpectedBins(expectedWidth);

  const rawUnderflow = Math.max(0, Number(rawHorizon?.underflow_prob ?? 0) || 0);
  const rawOverflow = Math.max(0, Number(rawHorizon?.overflow_prob ?? 0) || 0);

  const rawProbs: number[] = templateBins.map((tpl, idx) => {
    const candidate = rawHorizon?.bins?.[idx];
    const val = Number(candidate?.prob ?? 0);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  });

  const rawSum = rawUnderflow + rawProbs.reduce((a, b) => a + b, 0) + rawOverflow;
  const safeRawSum = rawSum > 0 ? rawSum : 1;

  // Normalize all probabilities to integer basis points (sum = 10000)
  const scaleFactor = 10000 / safeRawSum;
  let underflowBp = Math.round(rawUnderflow * scaleFactor);
  let overflowBp = Math.round(rawOverflow * scaleFactor);
  const binBps = rawProbs.map((p) => Math.round(p * scaleFactor));

  const currentBpSum = underflowBp + overflowBp + binBps.reduce((a, b) => a + b, 0);
  const diffBp = 10000 - currentBpSum;

  // Adjust the highest-probability central bin so total === 10000 exactly
  let maxBinIdx = 4;
  let maxBinVal = -1;
  for (let i = 0; i < binBps.length; i++) {
    if (binBps[i] > maxBinVal) {
      maxBinVal = binBps[i];
      maxBinIdx = i;
    }
  }

  if (binBps[maxBinIdx] + diffBp >= 0) {
    binBps[maxBinIdx] += diffBp;
  } else {
    // Fallback: distribute adjustment across central bins or tails safely
    let remaining = diffBp;
    for (let i = 0; i < binBps.length && remaining !== 0; i++) {
      if (binBps[i] + remaining >= 0) {
        binBps[i] += remaining;
        remaining = 0;
      }
    }
    if (remaining !== 0) {
      underflowBp = Math.max(0, underflowBp + remaining);
    }
  }

  const underflowProb = round4(underflowBp / 10000);
  const overflowProb = round4(overflowBp / 10000);

  let runningBp = underflowBp;
  const reconciledBins: BinItem[] = templateBins.map((tpl, idx) => {
    const probBp = binBps[idx];
    runningBp += probBp;
    return {
      min_pct: tpl.min_pct,
      max_pct: tpl.max_pct,
      prob: round4(probBp / 10000),
      cdf: round4(runningBp / 10000),
    };
  });

  // Compute exact discrete moments
  const tailOffset = tailScaleFor(expectedWidth);
  const underflowMean = leftTailConditionalMean(
    leftTail(reconciledBins[0].min_pct, expectedWidth),
    1
  );
  const overflowMean = reconciledBins[reconciledBins.length - 1].max_pct + tailOffset;

  let mean = underflowProb * underflowMean + overflowProb * overflowMean;
  for (const b of reconciledBins) {
    mean += b.prob * ((b.min_pct + b.max_pct) / 2);
  }

  let variance =
    underflowProb * Math.pow(underflowMean - mean, 2) +
    overflowProb * Math.pow(overflowMean - mean, 2);
  for (const b of reconciledBins) {
    const mid = (b.min_pct + b.max_pct) / 2;
    // Sheppard's variance correction for uniform bin width: w^2 / 12
    variance += b.prob * (Math.pow(mid - mean, 2) + Math.pow(expectedWidth, 2) / 12);
  }
  const std = Math.sqrt(Math.max(0, variance));

  let probPositive = overflowProb;
  for (const b of reconciledBins) {
    if (b.min_pct >= 0) {
      probPositive += b.prob;
    } else if (b.max_pct > 0) {
      const posFrac = b.max_pct / (b.max_pct - b.min_pct);
      probPositive += b.prob * posFrac;
    }
  }

  const p01 = interpolateQuantile(0.01, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p05 = interpolateQuantile(0.05, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p25 = interpolateQuantile(0.25, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p50 = interpolateQuantile(0.5, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p75 = interpolateQuantile(0.75, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p95 = interpolateQuantile(0.95, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const p99 = interpolateQuantile(0.99, underflowProb, overflowProb, reconciledBins, expectedWidth);
  const es5 = computeExpectedShortfall5Pct(underflowProb, reconciledBins, expectedWidth);

  const reconciledSum = round4(
    underflowProb +
      reconciledBins.reduce((acc, b) => acc + b.prob, 0) +
      overflowProb
  );

  let cdfMonotonic = reconciledBins[0].cdf >= underflowProb;
  for (let i = 1; i < reconciledBins.length; i++) {
    if (reconciledBins[i].cdf < reconciledBins[i - 1].cdf) {
      cdfMonotonic = false;
    }
  }
  if (Math.abs(reconciledBins[reconciledBins.length - 1].cdf - (1 - overflowProb)) > 0.0002) {
    cdfMonotonic = false;
  }

  const quantilesCoherent =
    p01 <= p05 && p05 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p95 && p95 <= p99;

  return {
    horizon: {
      label: spec.label,
      trading_days: spec.trading_days,
      bin_width_pct: expectedWidth,
      underflow_prob: underflowProb,
      overflow_prob: overflowProb,
      bins: reconciledBins,
      summary: {
        mean_pct: round2(mean),
        median_pct: round2(p50),
        std_pct: round2(std),
        prob_positive: round4(Math.min(1, Math.max(0, probPositive))),
        expected_shortfall_5pct: round2(es5),
        quantiles_pct: {
          p01: round2(p01),
          p05: round2(p05),
          p25: round2(p25),
          p75: round2(p75),
          p95: round2(p95),
          p99: round2(p99),
        },
      },
    },
    audit: {
      horizon: spec.key,
      raw_prob_sum: round4(rawSum),
      reconciled_prob_sum: reconciledSum,
      cdf_monotonic: cdfMonotonic,
      quantiles_coherent: quantilesCoherent,
      adjustment_applied_bp: diffBp,
    },
  };
}

function reconcileWeights(raw: StrategyWeights): {
  weights: StrategyWeights;
  rawSum: number;
  reconciledSum: number;
} {
  const keys: Array<keyof StrategyWeights> = [
    'momentum_trend',
    'mean_reversion',
    'volatility_harvesting',
    'cash_defensive',
  ];

  const vals = keys.map((k) => {
    const v = Number(raw?.[k] ?? 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });
  const rawSum = vals.reduce((a, b) => a + b, 0);
  const safeSum = rawSum > 0 ? rawSum : 1;

  const pcts = vals.map((v) => Math.round((v / safeSum) * 100));
  const diff = 100 - pcts.reduce((a, b) => a + b, 0);

  let maxIdx = 0;
  for (let i = 1; i < pcts.length; i++) {
    if (pcts[i] > pcts[maxIdx]) maxIdx = i;
  }
  pcts[maxIdx] = Math.max(0, pcts[maxIdx] + diff);

  const weights: StrategyWeights = {
    momentum_trend: round2(pcts[0] / 100),
    mean_reversion: round2(pcts[1] / 100),
    volatility_harvesting: round2(pcts[2] / 100),
    cash_defensive: round2(pcts[3] / 100),
  };

  const reconciledSum = round2(
    weights.momentum_trend +
      weights.mean_reversion +
      weights.volatility_harvesting +
      weights.cash_defensive
  );

  return { weights, rawSum: round2(rawSum), reconciledSum };
}

export function auditAndReconcileForecast(
  payload: ForecastPayload,
  leverageFactor: number,
  calibrationMode: CalibrationMode
): { payload: ForecastPayload; audit: MathAuditReport } {
  const horizonEntries: HorizonAuditEntry[] = [];
  const reconciledHorizons = {} as Record<HorizonKey, HorizonForecast>;

  for (const spec of HORIZON_SPECS) {
    const { horizon, audit } = reconcileHorizon(
      payload.horizons[spec.key],
      spec,
      leverageFactor,
      calibrationMode
    );
    reconciledHorizons[spec.key] = horizon;
    horizonEntries.push(audit);
  }

  const weightResult = reconcileWeights(payload.execution_signals.suggested_strategy_weights);

  const auditedPayload: ForecastPayload = {
    ...payload,
    schema_version: '1.1.0',
    return_type: 'simple_pct',
    execution_signals: {
      ...payload.execution_signals,
      data_quality: {
        confidence_score: round2(
          Math.min(1, Math.max(0, payload.execution_signals.data_quality.confidence_score))
        ),
        source_coverage: payload.execution_signals.data_quality.source_coverage,
        missing_inputs: payload.execution_signals.data_quality.missing_inputs ?? [],
      },
      implied_vs_realized_vol_spread_pct: round2(
        payload.execution_signals.implied_vs_realized_vol_spread_pct
      ),
      expected_1d_move_pct: round2(Math.abs(payload.execution_signals.expected_1d_move_pct)),
      kelly_fraction_cap: round2(
        Math.min(1, Math.max(0, payload.execution_signals.kelly_fraction_cap))
      ),
      suggested_strategy_weights: weightResult.weights,
    },
    horizons: reconciledHorizons,
  };

  const allPassed =
    Math.abs(weightResult.reconciledSum - 1) < 0.001 &&
    horizonEntries.every(
      (h) =>
        Math.abs(h.reconciled_prob_sum - 1) < 0.0002 &&
        h.cdf_monotonic &&
        h.quantiles_coherent
    );

  return {
    payload: auditedPayload,
    audit: {
      audited_at: new Date().toISOString(),
      all_passed: allPassed,
      strategy_weight_raw_sum: weightResult.rawSum,
      strategy_weight_reconciled_sum: weightResult.reconciledSum,
      horizons: horizonEntries,
    },
  };
}
