import fs from 'fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ForecastPayload, ForecastRecord, HorizonKey } from '../src/types/forecast.ts';

/**
 * Runtime contract for generated forecast JSON.
 *
 * 1. Structural validation against schemas/forecast-record.schema.json
 *    (JSON Schema draft 2020-12, the language-neutral source of truth).
 * 2. Semantic validation of cross-field rules that JSON Schema cannot express:
 *    probability mass sums to 1, CDF matches cumulative bin mass, bins are
 *    contiguous, underflow mass sits above the -100% floor, quantiles are ordered, strategy weights sum to 1, the audit
 *    covers every horizon, and snapshot/payload agree on the symbol.
 *
 * Every record is checked before it is persisted (see server/storage.ts), so an
 * invalid forecast fails loudly instead of being published.
 */

export const FORECAST_RECORD_SCHEMA_URL = new URL(
  '../schemas/forecast-record.schema.json',
  import.meta.url
);

export const FORECAST_RECORD_SCHEMA: Record<string, unknown> = JSON.parse(
  fs.readFileSync(FORECAST_RECORD_SCHEMA_URL, 'utf-8')
);

export const FORECAST_RECORD_SCHEMA_ID = String(FORECAST_RECORD_SCHEMA.$id);

/** Tolerance for probability sums and CDF checks (values are stored at 4 decimals). */
const PROB_TOLERANCE = 0.0005;
/** Tolerance for strategy weights (stored at 2 decimals, reconciled to sum to 1). */
const WEIGHT_TOLERANCE = 0.001;
/** Tolerance for bin edges and percentage values (stored at 2 decimals). */
const PCT_TOLERANCE = 0.011;
/** A long position cannot lose more than 100%: simple returns are bounded below by -100. */
const SIMPLE_RETURN_FLOOR_PCT = -100;

const HORIZON_KEYS: HorizonKey[] = [
  'tomorrow',
  'next_week',
  'next_month',
  'next_quarter',
  'next_year',
];

export type ForecastValidationIssueKind = 'schema' | 'semantic';

export interface ForecastValidationIssue {
  kind: ForecastValidationIssueKind;
  /** JSON Pointer into the validated document ('' is the document root). */
  path: string;
  message: string;
}

export interface ForecastValidationResult {
  valid: boolean;
  schema_id: string;
  issues: ForecastValidationIssue[];
}

export class ForecastValidationError extends Error {
  readonly issues: ForecastValidationIssue[];

  constructor(subject: string, issues: ForecastValidationIssue[]) {
    const shown = issues.slice(0, 12).map((i) => `${i.path || '/'} ${i.message}`);
    const more = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : '';
    super(`${subject} failed JSON Schema validation: ${shown.join('; ')}${more}`);
    this.name = 'ForecastValidationError';
    this.issues = issues;
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
addFormats(ajv);
ajv.addSchema(FORECAST_RECORD_SCHEMA);

function compiledDefinition(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${FORECAST_RECORD_SCHEMA_ID}#/$defs/${name}`);
  if (!validate) {
    throw new Error(`Schema definition ${name} is missing from ${FORECAST_RECORD_SCHEMA_ID}.`);
  }
  return validate;
}

const validateRecordSchema = compiledDefinition('ForecastRecord');
const validatePayloadSchema = compiledDefinition('ForecastPayload');

function schemaIssues(errors: ErrorObject[] | null | undefined, prefix = ''): ForecastValidationIssue[] {
  return (errors ?? []).map((error) => {
    let message = error.message ?? 'is invalid';
    if (error.keyword === 'additionalProperties') {
      message = `has unexpected property "${String(
        (error.params as { additionalProperty?: unknown }).additionalProperty
      )}"`;
    } else if (error.keyword === 'enum') {
      message = `${message}: ${JSON.stringify(
        (error.params as { allowedValues?: unknown }).allowedValues
      )}`;
    } else if (error.keyword === 'const') {
      message = `${message}: ${JSON.stringify(
        (error.params as { allowedValue?: unknown }).allowedValue
      )}`;
    }
    return { kind: 'schema', path: `${prefix}${error.instancePath}`, message };
  });
}

function semanticPayloadIssues(payload: ForecastPayload, prefix: string): ForecastValidationIssue[] {
  const issues: ForecastValidationIssue[] = [];
  const add = (path: string, message: string) =>
    issues.push({ kind: 'semantic', path: `${prefix}${path}`, message });

  for (const key of HORIZON_KEYS) {
    const horizon = payload.horizons[key];
    const base = `/horizons/${key}`;
    const { bins, summary } = horizon;

    const binMass = bins.reduce((acc, bin) => acc + bin.prob, 0);
    const totalMass = horizon.underflow_prob + binMass + horizon.overflow_prob;
    if (Math.abs(totalMass - 1) > PROB_TOLERANCE) {
      add(base, `probability mass (underflow + bins + overflow) is ${totalMass.toFixed(6)}, expected 1`);
    }

    // Simple returns cannot fall below -100% (the schema enforces the floor on
    // each value); underflow mass needs room strictly above that floor.
    if (horizon.underflow_prob > 0 && bins[0].min_pct <= SIMPLE_RETURN_FLOOR_PCT) {
      add(`${base}/underflow_prob`, `underflow_prob (${horizon.underflow_prob}) must be 0 when bins[0].min_pct (${bins[0].min_pct}) is at or below the ${SIMPLE_RETURN_FLOOR_PCT}% simple-return floor`);
    }

    let running = horizon.underflow_prob;
    bins.forEach((bin, idx) => {
      const binPath = `${base}/bins/${idx}`;
      if (!(bin.max_pct > bin.min_pct)) {
        add(binPath, `max_pct (${bin.max_pct}) must be greater than min_pct (${bin.min_pct})`);
      } else if (Math.abs(bin.max_pct - bin.min_pct - horizon.bin_width_pct) > PCT_TOLERANCE) {
        add(binPath, `width ${(bin.max_pct - bin.min_pct).toFixed(4)} does not match bin_width_pct ${horizon.bin_width_pct}`);
      }
      if (idx > 0 && Math.abs(bin.min_pct - bins[idx - 1].max_pct) > 1e-6) {
        add(binPath, `min_pct (${bin.min_pct}) is not contiguous with previous max_pct (${bins[idx - 1].max_pct})`);
      }
      running += bin.prob;
      if (Math.abs(bin.cdf - running) > PROB_TOLERANCE) {
        add(`${binPath}/cdf`, `cdf ${bin.cdf} does not equal underflow_prob plus cumulative bin mass (${running.toFixed(4)})`);
      }
      if (idx > 0 && bin.cdf < bins[idx - 1].cdf) {
        add(`${binPath}/cdf`, 'cdf must be non-decreasing');
      }
    });
    const lastCdf = bins[bins.length - 1].cdf;
    if (Math.abs(lastCdf - (1 - horizon.overflow_prob)) > PROB_TOLERANCE) {
      add(`${base}/bins/${bins.length - 1}/cdf`, `final cdf ${lastCdf} must equal 1 - overflow_prob (${(1 - horizon.overflow_prob).toFixed(4)})`);
    }

    const q = summary.quantiles_pct;
    const ordered: Array<[string, number]> = [
      ['p01', q.p01],
      ['p05', q.p05],
      ['p25', q.p25],
      ['median_pct', summary.median_pct],
      ['p75', q.p75],
      ['p95', q.p95],
      ['p99', q.p99],
    ];
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i][1] < ordered[i - 1][1]) {
        add(`${base}/summary`, `quantiles out of order: ${ordered[i - 1][0]} (${ordered[i - 1][1]}) > ${ordered[i][0]} (${ordered[i][1]})`);
      }
    }
    if (summary.expected_shortfall_5pct > q.p05 + PCT_TOLERANCE) {
      add(`${base}/summary/expected_shortfall_5pct`, `expected shortfall (${summary.expected_shortfall_5pct}) cannot exceed the 5th percentile (${q.p05})`);
    }
  }

  const weights = payload.execution_signals.suggested_strategy_weights;
  const weightSum =
    weights.momentum_trend + weights.mean_reversion + weights.volatility_harvesting + weights.cash_defensive;
  if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
    add('/execution_signals/suggested_strategy_weights', `weights sum to ${weightSum.toFixed(4)}, expected 1`);
  }

  return issues;
}

function semanticRecordIssues(record: ForecastRecord): ForecastValidationIssue[] {
  const issues = semanticPayloadIssues(record.payload, '/payload');
  const add = (path: string, message: string) => issues.push({ kind: 'semantic', path, message });

  if (record.snapshot.symbol !== record.payload.symbol) {
    add('/snapshot/symbol', `snapshot symbol ${record.snapshot.symbol} does not match payload symbol ${record.payload.symbol}`);
  }

  const audited = record.audit.horizons.map((h) => h.horizon);
  for (const key of HORIZON_KEYS) {
    const count = audited.filter((h) => h === key).length;
    if (count !== 1) {
      add('/audit/horizons', `horizon ${key} appears ${count} times; expected exactly once`);
    }
  }
  if (!record.audit.all_passed) {
    add('/audit/all_passed', 'deterministic probability audit reported a failure');
  }

  return issues;
}

function result(issues: ForecastValidationIssue[]): ForecastValidationResult {
  return { valid: issues.length === 0, schema_id: FORECAST_RECORD_SCHEMA_ID, issues };
}

/** Validate a complete forecast record (structure first, then cross-field rules). */
export function validateForecastRecord(record: unknown): ForecastValidationResult {
  if (!validateRecordSchema(record)) {
    return result(schemaIssues(validateRecordSchema.errors));
  }
  return result(semanticRecordIssues(record as ForecastRecord));
}

/** Validate a forecast payload on its own (e.g. the audited payload before it is wrapped in a record). */
export function validateForecastPayload(payload: unknown): ForecastValidationResult {
  if (!validatePayloadSchema(payload)) {
    return result(schemaIssues(validatePayloadSchema.errors));
  }
  return result(semanticPayloadIssues(payload as ForecastPayload, ''));
}

export function assertValidForecastRecord(record: unknown): asserts record is ForecastRecord {
  const outcome = validateForecastRecord(record);
  if (!outcome.valid) {
    const id =
      typeof record === 'object' && record !== null && 'id' in record
        ? ` ${String((record as { id: unknown }).id)}`
        : '';
    throw new ForecastValidationError(`Forecast record${id}`, outcome.issues);
  }
}
