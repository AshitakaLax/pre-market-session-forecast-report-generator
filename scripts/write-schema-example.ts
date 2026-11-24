/**
 * Regenerate schemas/examples/forecast-record.example.json from the typed test
 * fixture. Run after changing the forecast contract:
 *
 *   npm run schema:example
 */
import fs from 'node:fs';
import { assertValidForecastRecord } from '../server/forecastValidation.ts';
import { buildSampleForecastRecord } from '../tests/fixtures/sampleForecastRecord.ts';

const target = new URL('../schemas/examples/forecast-record.example.json', import.meta.url);
const record = buildSampleForecastRecord();
assertValidForecastRecord(record);
fs.mkdirSync(new URL('.', target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
console.log(`Wrote ${target.pathname}`);
