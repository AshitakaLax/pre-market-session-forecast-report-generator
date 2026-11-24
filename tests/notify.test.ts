import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { notifyMissedDeadline, notifyValidated } from '../server/notify.ts';

function recorder() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body });
    return new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('notifications', () => {
  it('pings the dead-man switch after a validated save', async () => {
    const { calls, fetcher } = recorder();
    await notifyValidated('2026-11-24', ['TQQQ'], fetcher, { HEALTHCHECK_PING_URL: 'https://hc.test/abc' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://hc.test/abc');
  });

  it('signals failure and posts the webhook on a missed deadline', async () => {
    const { calls, fetcher } = recorder();
    await notifyMissedDeadline('2026-11-24', ['TQQQ'], 'Yahoo 429', fetcher, {
      HEALTHCHECK_PING_URL: 'https://hc.test/abc/',
      ALERT_WEBHOOK_URL: 'https://hooks.test/x',
    });
    assert.deepEqual(calls.map((c) => c.url), ['https://hc.test/abc/fail', 'https://hooks.test/x']);
    assert.match(String(calls[1].body), /MISSED/);
  });

  it('is a no-op when nothing is configured and never throws on failures', async () => {
    const { calls, fetcher } = recorder();
    await notifyValidated('2026-11-24', ['TQQQ'], fetcher, {});
    assert.equal(calls.length, 0);
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await notifyValidated('2026-11-24', ['TQQQ'], failing, { HEALTHCHECK_PING_URL: 'https://hc.test/abc' });
  });
});
