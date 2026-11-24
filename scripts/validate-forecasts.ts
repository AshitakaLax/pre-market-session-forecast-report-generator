/**
 * Validate forecast JSON files against schemas/forecast-record.schema.json
 * plus the semantic probability rules.
 *
 *   npm run validate:forecasts                 # data/forecasts.json
 *   npm run validate:forecasts -- a.json b.json
 *
 * Each file may hold a single forecast record or an array of records.
 * Exits non-zero if any record is invalid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FORECAST_RECORD_SCHEMA_ID, validateForecastRecord } from '../server/forecastValidation.ts';

const files = process.argv.slice(2);
if (files.length === 0) files.push(path.join('data', 'forecasts.json'));

let checked = 0;
let failed = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`✗ ${file}: file not found`);
    failed++;
    continue;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    console.error(`✗ ${file}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    failed++;
    continue;
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  records.forEach((record, index) => {
    checked++;
    const label = `${file}${Array.isArray(parsed) ? `[${index}]` : ''}`;
    const id =
      typeof record === 'object' && record !== null && 'id' in record ? String(record.id) : 'unknown id';
    const outcome = validateForecastRecord(record);
    if (outcome.valid) {
      console.log(`✓ ${label} (${id})`);
      return;
    }
    failed++;
    console.error(`✗ ${label} (${id})`);
    for (const issue of outcome.issues) {
      console.error(`    [${issue.kind}] ${issue.path || '/'} ${issue.message}`);
    }
  });
}

console.log(`\n${checked} record(s) checked against ${FORECAST_RECORD_SCHEMA_ID}; ${failed} invalid.`);
process.exit(failed > 0 ? 1 : 0);
