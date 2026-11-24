import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// storage.ts reads FORECAST_DATA_DIR on every call, so point it at a temp dir.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-test-'));
process.env.FORECAST_DATA_DIR = path.join(tmp, 'data');
const storage = await import('../server/storage.ts');

describe('schedule config defaults and migration', () => {
  it('defaults to a 04:05 start with a 04:25 retry cutoff', () => {
    const c = storage.readScheduleConfig();
    assert.equal(c.time_et, '04:05');
    assert.equal(c.retry_cutoff_et, '04:25');
    assert.equal(c.last_successful_run_date_et, null);
  });

  it('migrates a persisted legacy 04:30 start (the deadline itself)', () => {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'data', 'schedule.json'),
      JSON.stringify({ enabled: true, time_et: '04:30', last_scheduled_run_date_et: '2026-11-23' })
    );
    const c = storage.readScheduleConfig();
    assert.equal(c.time_et, '04:05');
    assert.equal(c.enabled, true);
    assert.equal(c.config_version, 2);
  });

  it('keeps a deliberately chosen time on a current-version config', () => {
    fs.writeFileSync(
      path.join(tmp, 'data', 'schedule.json'),
      JSON.stringify({ time_et: '04:10', config_version: 2 })
    );
    assert.equal(storage.readScheduleConfig().time_et, '04:10');
  });
});
