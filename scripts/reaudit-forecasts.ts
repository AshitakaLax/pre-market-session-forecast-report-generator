/**
 * Re-run the deterministic math audit (server/mathAudit.ts) over stored
 * forecast records so their derived summaries (moments, quantiles, expected
 * shortfall) pick up changes to the audit math.
 *
 *   npm run reaudit:forecasts                  # data/forecasts.json
 *   npm run reaudit:forecasts -- a.json b.json
 *
 * Only derived values are rewritten: the script aborts without writing if any
 * horizon's bins, underflow or overflow probability would change, and every
 * rewritten record must pass validateForecastRecord.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertValidForecastRecord } from '../server/forecastValidation.ts';
import { auditAndReconcileForecast } from '../server/mathAudit.ts';
import type { ForecastRecord, HorizonForecast } from '../src/types/forecast.ts';

function probabilityFingerprint(horizons: Record<string, HorizonForecast>): string {
  return JSON.stringify(
    Object.entries(horizons)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, h]) => [key, h.bin_width_pct, h.underflow_prob, h.overflow_prob, h.bins])
  );
}

export function reauditRecord(record: ForecastRecord): ForecastRecord {
  const { payload, audit } = auditAndReconcileForecast(
    record.payload,
    record.snapshot.leverage_factor,
    record.calibration_mode
  );
  if (probabilityFingerprint(payload.horizons) !== probabilityFingerprint(record.payload.horizons)) {
    throw new Error(
      `Re-audit of ${record.id} would change bin probabilities; refusing to rewrite model output.`
    );
  }
  const updated: ForecastRecord = { ...record, payload, audit };
  assertValidForecastRecord(updated);
  return updated;
}

const files = process.argv.slice(2);
if (files.length === 0) files.push(path.join('data', 'forecasts.json'));

for (const file of files) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as ForecastRecord | ForecastRecord[];
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const updated = records.map(reauditRecord);
  const output = Array.isArray(parsed) ? updated : updated[0];
  // Same formatting as server/storage.ts.
  fs.writeFileSync(file, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Re-audited ${updated.length} record(s) in ${file}`);
}
