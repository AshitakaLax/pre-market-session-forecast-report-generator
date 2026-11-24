import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideScheduledAction, retryBackoffSeconds, taskTriggerSkipReason } from '../server/scheduler.ts';
import type { ScheduleConfig } from '../src/types/forecast.ts';

const base: ScheduleConfig = {
  enabled: true,
  time_et: '04:05',
  trading_days_only: true,
  symbols: ['TQQQ'],
  calibration_mode: 'leveraged_scaled',
  run_window: 'pre_market',
  last_scheduled_run_date_et: null,
  last_run_status: null,
  retry_cutoff_et: '04:25',
  last_successful_run_date_et: null,
  attempts_date_et: null,
  attempts_today: 0,
  last_attempt_at: null,
  missed_alert_date_et: null,
  config_version: 2,
};

const DATE = '2026-11-24';
const NOW = Date.parse('2026-11-24T09:10:00Z');

function decide(overrides: Partial<ScheduleConfig>, extra: Partial<Parameters<typeof decideScheduledAction>[0]> = {}) {
  return decideScheduledAction({
    config: { ...base, ...overrides },
    dateEt: DATE,
    timeEt: '04:05',
    nowMs: NOW,
    isTradingDay: true,
    pendingSymbols: ['TQQQ'],
    ...extra,
  });
}

describe('retryBackoffSeconds', () => {
  it('doubles from 30s and caps at 120s', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryBackoffSeconds), [0, 30, 60, 120, 120, 120]);
  });
});

describe('decideScheduledAction', () => {
  it('starts at the start time, not the deadline', () => {
    assert.equal(decide({}).action, 'run');
    assert.equal(decide({}, { timeEt: '04:04' }).reason, 'before_start');
  });

  it('skips when disabled, on non-trading days, or when already complete', () => {
    assert.equal(decide({ enabled: false }).reason, 'disabled');
    assert.equal(decide({}, { isTradingDay: false }).reason, 'not_trading_day');
    assert.equal(decide({}, { pendingSymbols: [] }).reason, 'complete');
  });

  it('retries a failed attempt the same morning once the backoff has elapsed', () => {
    const failedAt = new Date(NOW - 20_000).toISOString();
    const waiting = decide({ attempts_date_et: DATE, attempts_today: 1, last_attempt_at: failedAt });
    assert.equal(waiting.reason, 'backoff');

    const due = decide({
      attempts_date_et: DATE,
      attempts_today: 1,
      last_attempt_at: new Date(NOW - 31_000).toISOString(),
    });
    assert.deepEqual(due, { action: 'run', reason: 'retry' });
  });

  it('ignores yesterday\'s attempts', () => {
    const d = decide({
      attempts_date_et: '2026-11-23',
      attempts_today: 5,
      last_attempt_at: new Date(NOW - 1_000).toISOString(),
    });
    assert.deepEqual(d, { action: 'run', reason: 'first_attempt' });
  });

  it('stops retrying at the cutoff and alerts exactly once', () => {
    assert.equal(decide({}, { timeEt: '04:24' }).action, 'run');
    assert.equal(decide({}, { timeEt: '04:25' }).action, 'alert_missed');
    assert.equal(decide({ missed_alert_date_et: DATE }, { timeEt: '04:26' }).reason, 'past_cutoff');
  });

  it('does not raise a stale alert after the market has opened', () => {
    assert.equal(decide({}, { timeEt: '10:00' }).reason, 'past_cutoff');
  });

  it('does not alert when every symbol is already validated', () => {
    assert.equal(decide({}, { timeEt: '04:30', pendingSymbols: [] }).reason, 'complete');
  });
});

describe('taskTriggerSkipReason', () => {
  const gate = (o: Partial<Parameters<typeof taskTriggerSkipReason>[0]> = {}) =>
    taskTriggerSkipReason({
      config: { trading_days_only: true, time_et: '04:05' },
      dateEt: DATE,
      weekday: 'Tue',
      timeEt: '04:05',
      isTradingDay: true,
      force: false,
      ...o,
    });

  it('proceeds at or after the start time on a trading day', () => {
    assert.equal(gate(), null);
    assert.equal(gate({ timeEt: '05:05' }), null);
  });
  it('skips holidays/weekends', () => {
    assert.match(gate({ isTradingDay: false }) ?? '', /Market closed/);
  });
  it('skips triggers that fire before the start (wrong half of a DST double-cron)', () => {
    assert.match(gate({ timeEt: '03:05' }) ?? '', /Too early/);
  });
  it('force overrides both', () => {
    assert.equal(gate({ force: true, timeEt: '03:05', isTradingDay: false }), null);
  });
});
