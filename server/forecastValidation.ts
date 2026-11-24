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

/** Frozen schemas for earlier versions, kept so stored records stay valid. */
const HISTORY_SCHEMA_DIR = new URL('../schemas/history/', import.meta.url);

function readSchema(url: URL): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(url, 'utf-8'));
}

/** The current contract. New records must use this version. */
export const FORECAST_RECORD_SCHEMA: Record<string, unknown> = readSchema(FORECAST_RECORD_SCHEMA_URL);

export const FORECAST_RECORD_SCHEMA_ID = String(FORECAST_RECORD_SCHEMA.$id);

function schemaVersionOf(schema: Record<string, unknown>): string {
  const defs = schema.$defs as Record<string, { properties?: Record<string, { const?: unknown }> }>;
  const version = defs?.ForecastPayload?.properties?.schema_version?.const;
  if (typeof version !== 'string') {
    throw new Error(`Schema ${String(schema.$id)} does not pin payload.schema_version with a const.`);
  }
  return version;
}

export const FORECAST_RECORD_SCHEMA_VERSION = schemaVersionOf(FORECAST_RECORD_SCHEMA);

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

interface VersionValidators {
  schemaId: string;
  record: ValidateFunction;
  payload: ValidateFunction;
}

function compileVersion(schema: Record<string, unknown>): VersionValidators {
  const schemaId = String(schema.$id);
  ajv.addSchema(schema);
  const definition = (name: string): ValidateFunction => {
    const validate = ajv.getSchema(`${schemaId}#/$defs/${name}`);
    if (!validate) throw new Error(`Schema definition ${name} is missing from ${schemaId}.`);
    return validate;
  };
  return { schemaId, record: definition('ForecastRecord'), payload: definition('ForecastPayload') };
}

const LATEST = compileVersion(FORECAST_RECORD_SCHEMA);

/** payload.schema_version -> validators for that version's frozen schema. */
const VALIDATORS = new Map<string, VersionValidators>([[FORECAST_RECORD_SCHEMA_VERSION, LATEST]]);
for (const file of fs.readdirSync(HISTORY_SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
  const schema = readSchema(new URL(file, HISTORY_SCHEMA_DIR));
  const version = schemaVersionOf(schema);
  if (VALIDATORS.has(version)) throw new Error(`Duplicate forecast schema for version ${version} (${file}).`);
  VALIDATORS.set(version, compileVersion(schema));
}

/** Every payload.schema_version this build can validate, newest contract first. */
export const SUPPORTED_FORECAST_SCHEMA_VERSIONS: string[] = Array.from(VALIDATORS.keys());

/**
 * Records are validated against the schema for the version they declare, so a
 * stored 1.1.0 record can still be re-saved (e.g. after verification). An unknown
 * version is checked against the current schema, whose const then rejects it.
 */
function validatorsFor(document: unknown, versionPath: 'record' | 'payload'): VersionValidators {
  const payload =
    versionPath === 'record'
      ? (document as { payload?: { schema_version?: unknown } } | null)?.payload
      : (document as { schema_version?: unknown } | null);
  const version = payload && typeof payload === 'object' ? payload.schema_version : undefined;
  return (typeof version === 'string' && VALIDATORS.get(version)) || LATEST;
}

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

function result(schemaId: string, issues: ForecastValidationIssue[]): ForecastValidationResult {
  return { valid: issues.length === 0, schema_id: schemaId, issues };
}

/** Validate a complete forecast record (structure first, then cross-field rules). */
export function validateForecastRecord(record: unknown): ForecastValidationResult {
  const { schemaId, record: validate } = validatorsFor(record, 'record');
  if (!validate(record)) {
    return result(schemaId, schemaIssues(validate.errors));
  }
  return result(schemaId, semanticRecordIssues(record as ForecastRecord));
}

/** Validate a forecast payload on its own (e.g. the audited payload before it is wrapped in a record). */
export function validateForecastPayload(payload: unknown): ForecastValidationResult {
  const { schemaId, payload: validate } = validatorsFor(payload, 'payload');
  if (!validate(payload)) {
    return result(schemaId, schemaIssues(validate.errors));
  }
  return result(schemaId, semanticPayloadIssues(payload as ForecastPayload, ''));
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
