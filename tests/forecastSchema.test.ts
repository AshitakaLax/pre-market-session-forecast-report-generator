import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  ForecastValidationError,
  assertValidForecastRecord,
  validateForecastPayload,
  validateForecastRecord,
} from '../server/forecastValidation.ts';
import type { ForecastRecord } from '../src/types/forecast.ts';
import { buildSampleForecastRecord } from './fixtures/sampleForecastRecord.ts';

const EXAMPLE_URL = new URL('../schemas/examples/forecast-record.example.json', import.meta.url);

function sample(): ForecastRecord {
  return structuredClone(buildSampleForecastRecord());
}

function issuePaths(record: unknown): string[] {
  return validateForecastRecord(record).issues.map((i) => `${i.kind}:${i.path}`);
}

describe('forecast record JSON Schema', () => {
  it('accepts a fully populated record produced by the audit code path', () => {
    const outcome = validateForecastRecord(sample());
    assert.deepEqual(outcome.issues, []);
    assert.equal(outcome.valid, true);
  });

  it('accepts the published example record', () => {
    const example = JSON.parse(fs.readFileSync(EXAMPLE_URL, 'utf-8'));
    assert.deepEqual(validateForecastRecord(example).issues, []);
  });

  it('accepts the audited payload on its own', () => {
    assert.deepEqual(validateForecastPayload(sample().payload).issues, []);
  });

  it('accepts records without the optional fields', () => {
    const record = sample() as Partial<ForecastRecord> & { snapshot: Record<string, unknown> };
    delete record.verification;
    delete record.snapshot.base_session_date;
    delete record.snapshot.futures_daily_change_pct;
    assert.deepEqual(validateForecastRecord(record).issues, []);
  });

  it('rejects unexpected properties so new fields cannot drift past the schema', () => {
    const record = sample() as unknown as { snapshot: Record<string, unknown> };
    record.snapshot.vix1d_level = 21.4;
    assert.deepEqual(issuePaths(record), ['schema:/snapshot']);
  });

  it('rejects missing required properties', () => {
    const record = sample() as unknown as { payload: Record<string, unknown> };
    delete record.payload.base_price;
    assert.deepEqual(issuePaths(record), ['schema:/payload']);
  });

  it('rejects out-of-range probabilities', () => {
    const record = sample();
    record.payload.horizons.tomorrow.bins[3].prob = 1.2;
    assert.ok(issuePaths(record).includes('schema:/payload/horizons/tomorrow/bins/3/prob'));
  });

  it('rejects unknown enum values', () => {
    const record = sample() as unknown as { payload: { execution_signals: Record<string, unknown> } };
    record.payload.execution_signals.regime = 'sideways';
    assert.deepEqual(issuePaths(record), ['schema:/payload/execution_signals/regime']);
  });

  it('rejects a horizon whose trading_days does not match its key', () => {
    const record = sample();
    record.payload.horizons.next_week.trading_days = 4;
    assert.ok(issuePaths(record).includes('schema:/payload/horizons/next_week/trading_days'));
  });

  it('rejects the wrong number of bins', () => {
    const record = sample();
    record.payload.horizons.next_month.bins.pop();
    assert.ok(issuePaths(record).includes('schema:/payload/horizons/next_month/bins'));
  });

  it('rejects NaN and Infinity, which JSON.stringify would silently turn into null', () => {
    const record = sample();
    record.snapshot.vix_level = Number.NaN;
    record.payload.horizons.tomorrow.summary.std_pct = Number.POSITIVE_INFINITY;
    const paths = issuePaths(record);
    assert.ok(paths.includes('schema:/snapshot/vix_level'));
    assert.ok(paths.includes('schema:/payload/horizons/tomorrow/summary/std_pct'));
  });

  it('rejects simple returns below the -100% floor', () => {
    const record = sample();
    const summary = record.payload.horizons.next_year.summary;
    summary.quantiles_pct.p01 = -115.75;
    summary.expected_shortfall_5pct = -107.98;
    summary.mean_pct = -100.01;
    summary.median_pct = -101;
    record.payload.horizons.next_year.bins[0].min_pct = -100.5;
    const paths = issuePaths(record);
    for (const field of [
      'summary/quantiles_pct/p01',
      'summary/expected_shortfall_5pct',
      'summary/mean_pct',
      'summary/median_pct',
      'bins/0/min_pct',
    ]) {
      assert.ok(paths.includes(`schema:/payload/horizons/next_year/${field}`), field);
    }
  });

  it('accepts a simple return of exactly -100% (total loss)', () => {
    const record = sample();
    const q = record.payload.horizons.next_year.summary.quantiles_pct;
    q.p01 = -100;
    record.payload.horizons.next_year.summary.expected_shortfall_5pct = -100;
    assert.ok(q.p05 >= -100);
    assert.deepEqual(issuePaths(record), []);
  });

  it('rejects timestamps without a time zone', () => {
    const record = sample();
    record.created_at = '2026-11-24 04:30:00';
    assert.deepEqual(issuePaths(record), ['schema:/created_at']);
  });

  it('rejects a schema_version other than the one this schema describes', () => {
    const record = sample();
    record.payload.schema_version = '1.2.0';
    assert.deepEqual(issuePaths(record), ['schema:/payload/schema_version']);
  });
});

describe('forecast record semantic rules', () => {
  it('rejects probability mass that does not sum to 1', () => {
    const record = sample();
    record.payload.horizons.tomorrow.overflow_prob += 0.05;
    const paths = issuePaths(record);
    assert.ok(paths.includes('semantic:/payload/horizons/tomorrow'));
  });

  it('rejects a CDF that disagrees with the bin probabilities', () => {
    const record = sample();
    record.payload.horizons.next_quarter.bins[5].cdf -= 0.01;
    assert.ok(issuePaths(record).includes('semantic:/payload/horizons/next_quarter/bins/5/cdf'));
  });

  it('rejects non-contiguous bins', () => {
    const record = sample();
    record.payload.horizons.next_year.bins[2].min_pct += 1;
    assert.ok(issuePaths(record).includes('semantic:/payload/horizons/next_year/bins/2'));
  });

  it('rejects out-of-order quantiles', () => {
    const record = sample();
    const q = record.payload.horizons.tomorrow.summary.quantiles_pct;
    [q.p05, q.p95] = [q.p95, q.p05];
    assert.ok(issuePaths(record).includes('semantic:/payload/horizons/tomorrow/summary'));
  });

  it('rejects underflow mass when the lowest bin already starts at -100%', () => {
    const record = sample();
    const horizon = record.payload.horizons.next_year;
    assert.ok(horizon.underflow_prob > 0);
    horizon.bin_width_pct = 20;
    horizon.bins.forEach((bin, idx) => {
      bin.min_pct = -100 + idx * 20;
      bin.max_pct = bin.min_pct + 20;
    });
    const paths = issuePaths(record);
    assert.deepEqual(paths, ['semantic:/payload/horizons/next_year/underflow_prob']);
  });

  it('rejects strategy weights that do not sum to 1', () => {
    const record = sample();
    record.payload.execution_signals.suggested_strategy_weights.cash_defensive = 0.9;
    assert.deepEqual(issuePaths(record), ['semantic:/payload/execution_signals/suggested_strategy_weights']);
  });

  it('rejects a snapshot for a different symbol', () => {
    const record = sample();
    record.snapshot.symbol = 'SQQQ';
    assert.deepEqual(issuePaths(record), ['semantic:/snapshot/symbol']);
  });

  it('rejects an audit that skipped a horizon', () => {
    const record = sample();
    record.audit.horizons[4] = { ...record.audit.horizons[0] };
    const paths = issuePaths(record);
    assert.ok(paths.includes('semantic:/audit/horizons'));
  });

  it('throws a descriptive error from assertValidForecastRecord', () => {
    const record = sample();
    record.payload.horizons.tomorrow.bins[0].prob = -0.1;
    assert.throws(
      () => assertValidForecastRecord(record),
      (error: unknown) =>
        error instanceof ForecastValidationError &&
        error.message.includes('/payload/horizons/tomorrow/bins/0/prob') &&
        error.issues.length > 0
    );
  });
});
