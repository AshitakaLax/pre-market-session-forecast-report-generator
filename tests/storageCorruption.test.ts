import { afterEach, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readForecasts,
  readForecastsForDisplay,
  readScheduleConfig,
  saveForecast,
  StorageCorruptionError,
  writeScheduleConfig,
} from '../server/storage.ts';
import type { ForecastRecord } from '../src/types/forecast.ts';
import { buildSampleForecastRecord } from './fixtures/sampleForecastRecord.ts';

const rec = (id: string): ForecastRecord => ({ ...buildSampleForecastRecord(), id });
const A = randomUUID();
const B = randomUUID();
let dir: string;
const f = (n: string) => path.join(dir, n);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  process.env.FORECAST_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.FORECAST_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('forecasts store', () => {
  it('treats a missing file as empty and saves normally', () => {
    assert.deepEqual(readForecasts(), []);
    saveForecast(rec(A));
    assert.deepEqual(readForecasts().map((r) => r.id), [A]);
  });

  for (const [label, content] of [
    ['invalid JSON', '{not json'],
    ['non-array JSON', '{"a":1}'],
  ]) {
    it(`refuses to overwrite a store with ${label}`, () => {
      fs.writeFileSync(f('forecasts.json'), content);
      assert.throws(() => saveForecast(rec(randomUUID())), StorageCorruptionError);
      assert.equal(fs.readFileSync(f('forecasts.json'), 'utf-8'), content);
      assert.throws(() => readForecasts(), StorageCorruptionError);
    });
  }

  it('display read returns an empty list with a warning and does not write', () => {
    fs.writeFileSync(f('forecasts.json'), 'garbage');
    const out = readForecastsForDisplay();
    assert.deepEqual(out.forecasts, []);
    assert.ok(out.warning);
    assert.equal(fs.readFileSync(f('forecasts.json'), 'utf-8'), 'garbage');
  });

  it('keeps a .bak of the previous valid contents', () => {
    saveForecast(rec(A));
    saveForecast(rec(B));
    const bak = JSON.parse(fs.readFileSync(f('forecasts.json.bak'), 'utf-8'));
    assert.deepEqual(bak.map((r: ForecastRecord) => r.id), [A]);
  });
});

describe('schedule config', () => {
  it('returns defaults when missing', () => {
    assert.equal(readScheduleConfig().enabled, false);
  });

  it('throws on corrupt schedule instead of silently disabling it', () => {
    fs.writeFileSync(f('schedule.json'), '{oops');
    assert.throws(() => readScheduleConfig(), StorageCorruptionError);
    fs.writeFileSync(f('schedule.json'), '[]');
    assert.throws(() => readScheduleConfig(), StorageCorruptionError);
  });

  it('round-trips and backs up valid config', () => {
    writeScheduleConfig({ ...readScheduleConfig(), enabled: true });
    writeScheduleConfig({ ...readScheduleConfig(), enabled: false });
    assert.equal(JSON.parse(fs.readFileSync(f('schedule.json.bak'), 'utf-8')).enabled, true);
  });
});
