import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateForecastPayload } from '../server/forecastValidation.ts';
import {
  MAX_BIN_WIDTH_PCT,
  SIMPLE_RETURN_FLOOR_PCT,
  auditAndReconcileForecast,
  buildExpectedBins,
  getBinWidthForSymbol,
  HORIZON_SPECS,
} from '../server/mathAudit.ts';
import type {
  CalibrationMode,
  ForecastPayload,
  HorizonForecast,
  HorizonKey,
  HorizonSummary,
} from '../src/types/forecast.ts';
import { buildSampleForecastRecord } from './fixtures/sampleForecastRecord.ts';

/** Raw (pre-audit) horizon from explicit probabilities: [underflow, ...10 bins, overflow]. */
function rawHorizon(
  key: HorizonKey,
  binWidthPct: number,
  underflow: number,
  binProbs: number[],
  overflow: number
): HorizonForecast {
  const spec = HORIZON_SPECS.find((s) => s.key === key)!;
  let cdf = underflow;
  return {
    label: spec.label,
    trading_days: spec.trading_days,
    bin_width_pct: binWidthPct,
    underflow_prob: underflow,
    overflow_prob: overflow,
    bins: buildExpectedBins(binWidthPct).map((edge, idx) => {
      cdf += binProbs[idx];
      return { ...edge, prob: binProbs[idx], cdf };
    }),
    summary: {
      mean_pct: 0,
      median_pct: 0,
      std_pct: 0,
      prob_positive: 0.5,
      expected_shortfall_5pct: 0,
      quantiles_pct: { p01: 0, p05: 0, p25: 0, p75: 0, p95: 0, p99: 0 },
    },
  };
}

/**
 * Audit a payload whose every horizon uses the same probability shape,
 * scaled to each horizon's leveraged bin width.
 */
function audit(
  leverage: number,
  underflow: number,
  binProbs: number[],
  overflow: number,
  calibrationMode: CalibrationMode = 'leveraged_scaled'
) {
  const base = structuredClone(buildSampleForecastRecord().payload);
  const horizons = {} as Record<HorizonKey, HorizonForecast>;
  for (const spec of HORIZON_SPECS) {
    const width = getBinWidthForSymbol(spec.base_bin_width_pct, leverage, calibrationMode);
    horizons[spec.key] = rawHorizon(spec.key, width, underflow, binProbs, overflow);
  }
  const raw: ForecastPayload = { ...base, horizons };
  return auditAndReconcileForecast(raw, leverage, calibrationMode);
}

function simpleReturnValues(summary: HorizonSummary): Array<[string, number]> {
  return [
    ['mean_pct', summary.mean_pct],
    ['median_pct', summary.median_pct],
    ['expected_shortfall_5pct', summary.expected_shortfall_5pct],
    ...Object.entries(summary.quantiles_pct),
  ];
}

function assertFloorAndCoherence(horizon: HorizonForecast, label: string) {
  for (const bin of horizon.bins) {
    assert.ok(bin.min_pct >= SIMPLE_RETURN_FLOOR_PCT, `${label} bin min_pct ${bin.min_pct} < -100`);
  }
  for (const [name, value] of simpleReturnValues(horizon.summary)) {
    assert.ok(Number.isFinite(value), `${label} ${name} is not finite`);
    assert.ok(value >= SIMPLE_RETURN_FLOOR_PCT, `${label} ${name} = ${value} is below -100%`);
  }
  const q = horizon.summary.quantiles_pct;
  const ordered = [q.p01, q.p05, q.p25, horizon.summary.median_pct, q.p75, q.p95, q.p99];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i] >= ordered[i - 1], `${label} quantiles out of order: ${ordered.join(', ')}`);
  }
  assert.ok(
    horizon.summary.expected_shortfall_5pct <= q.p05,
    `${label} ES ${horizon.summary.expected_shortfall_5pct} > p05 ${q.p05}`
  );
}

// Fat left tail: about a quarter of the mass below the lowest bin, like the
// stored TQQQ 252D record that previously produced p01 = -115.75.
const FAT_LEFT_UNDERFLOW = 0.25;
const FAT_LEFT_BINS = [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.08, 0.07, 0.06, 0.05];
const FAT_LEFT_OVERFLOW = 0.1;

describe('math audit left tail respects the -100% simple-return floor', () => {
  it('keeps a high-volatility 252-day 3x horizon above -100%', () => {
    const { payload, audit: report } = audit(3, FAT_LEFT_UNDERFLOW, FAT_LEFT_BINS, FAT_LEFT_OVERFLOW);
    const year = payload.horizons.next_year;
    assert.equal(year.bin_width_pct, 15);
    assert.equal(year.bins[0].min_pct, -75);
    assertFloorAndCoherence(year, 'next_year');
    // p01 and p05 lie inside the underflow tail, below the lowest bin edge.
    assert.ok(year.summary.quantiles_pct.p01 < -75);
    assert.ok(year.summary.quantiles_pct.p05 < -75);
    assert.ok(year.summary.expected_shortfall_5pct < year.summary.quantiles_pct.p05);
    assert.equal(report.all_passed, true);
    assert.deepEqual(validateForecastPayload(payload).issues, []);
  });

  it('leaves the probabilities unchanged', () => {
    const { payload } = audit(3, FAT_LEFT_UNDERFLOW, FAT_LEFT_BINS, FAT_LEFT_OVERFLOW);
    const year = payload.horizons.next_year;
    assert.equal(year.underflow_prob, FAT_LEFT_UNDERFLOW);
    assert.equal(year.overflow_prob, FAT_LEFT_OVERFLOW);
    assert.deepEqual(
      year.bins.map((b) => b.prob),
      FAT_LEFT_BINS
    );
  });

  it('stays above -100% even when almost all mass is in the underflow tail', () => {
    const bins = new Array(10).fill(0.004);
    const { payload } = audit(3, 0.95, bins, 0.01);
    for (const spec of HORIZON_SPECS) {
      assertFloorAndCoherence(payload.horizons[spec.key], spec.key);
    }
    const year = payload.horizons.next_year;
    assert.ok(year.summary.mean_pct > SIMPLE_RETURN_FLOOR_PCT);
    assert.ok(year.summary.quantiles_pct.p01 > SIMPLE_RETURN_FLOOR_PCT);
    assert.deepEqual(validateForecastPayload(payload).issues, []);
  });

  it('caps the bin width so leverage above 3x cannot push bin edges past -100%', () => {
    assert.equal(getBinWidthForSymbol(5, 5, 'leveraged_scaled'), MAX_BIN_WIDTH_PCT);
    const { payload } = audit(5, FAT_LEFT_UNDERFLOW, FAT_LEFT_BINS, FAT_LEFT_OVERFLOW);
    for (const spec of HORIZON_SPECS) {
      const horizon = payload.horizons[spec.key];
      assert.ok(horizon.bins[0].min_pct > SIMPLE_RETURN_FLOOR_PCT);
      assertFloorAndCoherence(horizon, spec.key);
    }
    assert.deepEqual(validateForecastPayload(payload).issues, []);
  });

  it('barely changes narrow, short-horizon tails', () => {
    // 1D 1x: width 0.5%. The old exponential tail gave
    // p01 = firstMin - tailScale * ln(underflow / 0.01).
    const { payload } = audit(1, 0.05, [0.05, 0.1, 0.1, 0.1, 0.15, 0.15, 0.1, 0.1, 0.05, 0.0], 0.05);
    const tomorrow = payload.horizons.tomorrow;
    const oldP01 = -2.5 - 0.5 * Math.log(0.05 / 0.01);
    assert.ok(Math.abs(tomorrow.summary.quantiles_pct.p01 - oldP01) < 0.02);
    assertFloorAndCoherence(tomorrow, 'tomorrow');
  });
});
