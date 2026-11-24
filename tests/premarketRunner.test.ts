import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPremarketRunner,
  findValidatedRecord,
  pendingSymbols,
  type PipelineParams,
} from '../server/premarketRunner.ts';
import type { ForecastRecord } from '../src/types/forecast.ts';
import { makeRecord } from './fixtures/forecastRecord.ts';

const DATE = '2026-11-24';
const opts = {
  dateEt: DATE,
  calibrationMode: 'leveraged_scaled' as const,
  runWindow: 'pre_market' as const,
  trigger: 'scheduled' as const,
};

function harness(pipeline: (p: PipelineParams, n: number) => Promise<ForecastRecord>, seed: ForecastRecord[] = []) {
  const store: ForecastRecord[] = [...seed];
  let calls = 0;
  const runner = createPremarketRunner({
    readForecasts: () => store,
    saveForecast: (r) => {
      store.unshift(r);
    },
    runPipeline: (p) => pipeline(p, ++calls),
  });
  return { runner, store, calls: () => calls };
}

describe('premarket runner idempotency', () => {
  it('reuses a validated record from today instead of running again', async () => {
    const seed = makeRecord({ id: 'existing' });
    const h = harness(async () => makeRecord({ id: 'new' }), [seed]);
    const [result] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    assert.equal(result.status, 'existing');
    assert.equal(result.record?.id, 'existing');
    assert.equal(h.calls(), 0);
  });

  it('repeated triggers create exactly one record', async () => {
    const h = harness(async (_p, n) => makeRecord({ id: `r${n}` }));
    const first = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    const second = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    assert.equal(first[0].status, 'created');
    assert.equal(second[0].status, 'existing');
    assert.equal(h.store.length, 1);
  });

  it('concurrent triggers share one in-flight run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(async () => {
      await gate;
      return makeRecord({ id: 'only' });
    });
    const a = h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    const b = h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(h.calls(), 1);
    assert.equal(h.store.length, 1);
    assert.equal(ra[0].record?.id, rb[0].record?.id);
  });

  it('does not treat yesterday, other symbols, or unvalidated records as done', () => {
    const records = [
      makeRecord({ id: 'y', createdAt: '2026-11-23T09:06:00Z' }),
      makeRecord({ id: 'o', symbol: 'SQQQ' }),
      makeRecord({ id: 'u', allPassed: false }),
      makeRecord({ id: 'w', runWindow: 'eod' }),
    ];
    assert.equal(findValidatedRecord(records, { ...opts, symbol: 'TQQQ' }), undefined);
    assert.deepEqual(pendingSymbols(records, { ...opts, symbols: ['TQQQ', 'SQQQ'] }), ['TQQQ']);
  });

  it('keys the ET date on the ET calendar, not UTC', () => {
    // 03:30 UTC on the 25th is still the evening of the 24th in New York.
    const late = makeRecord({ createdAt: '2026-11-25T03:30:00Z' });
    assert.ok(findValidatedRecord([late], { ...opts, symbol: 'TQQQ' }));
  });

  it('force bypasses the existing record', async () => {
    const h = harness(async () => makeRecord({ id: 'fresh' }), [makeRecord({ id: 'old' })]);
    const [r] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'], force: true });
    assert.equal(r.status, 'created');
  });

  it('honours an idempotency key even when the record is not today\'s', async () => {
    const keyed = { ...makeRecord({ id: 'k', createdAt: '2026-11-23T09:06:00Z' }), idempotency_key: 'sched-1' };
    const h = harness(async () => makeRecord({ id: 'new' }), [keyed]);
    const [r] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'], idempotencyKey: 'sched-1' });
    assert.equal(r.record?.id, 'k');
    assert.equal(h.calls(), 0);
  });

  it('stores the idempotency key on created records', async () => {
    const h = harness(async () => makeRecord({ id: 'n' }));
    await h.runner.runBatch({ ...opts, symbols: ['TQQQ'], idempotencyKey: 'sched-2' });
    assert.equal(h.store[0].idempotency_key, 'sched-2');
  });
});

describe('premarket runner failure handling', () => {
  it('a failed attempt saves nothing and the next attempt can succeed', async () => {
    const h = harness(async (_p, n) => {
      if (n === 1) throw new Error('Yahoo 429');
      return makeRecord({ id: 'ok' });
    });
    const [first] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    assert.equal(first.status, 'failed');
    assert.match(first.error ?? '', /429/);
    assert.equal(h.store.length, 0);

    const [second] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    assert.equal(second.status, 'created');
    assert.equal(h.store.length, 1);
  });

  it('refuses to publish a record that failed the audit', async () => {
    const h = harness(async () => makeRecord({ allPassed: false }));
    const [r] = await h.runner.runBatch({ ...opts, symbols: ['TQQQ'] });
    assert.equal(r.status, 'failed');
    assert.equal(h.store.length, 0);
  });

  it('retrying a partly failed batch only re-runs the failed symbol', async () => {
    let sqqqFailures = 1;
    const h = harness(async (p) => {
      if (p.symbol === 'SQQQ' && sqqqFailures-- > 0) throw new Error('timeout');
      return makeRecord({ id: `id-${p.symbol}`, symbol: p.symbol });
    });
    const first = await h.runner.runBatch({ ...opts, symbols: ['TQQQ', 'SQQQ'] });
    assert.deepEqual(first.map((r) => r.status), ['created', 'failed']);
    const second = await h.runner.runBatch({ ...opts, symbols: ['TQQQ', 'SQQQ'] });
    assert.deepEqual(second.map((r) => r.status), ['existing', 'created']);
    assert.equal(h.store.length, 2);
  });
});
