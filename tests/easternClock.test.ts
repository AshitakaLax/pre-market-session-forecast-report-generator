import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { easternClockAt, easternDateOf } from '../server/easternClock.ts';

describe('easternClockAt', () => {
  it('maps 04:05 ET to the right UTC instant in both EST and EDT', () => {
    assert.equal(easternClockAt(new Date('2026-11-24T09:05:00Z')).timeEt, '04:05'); // EST (UTC-5)
    assert.equal(easternClockAt(new Date('2026-07-14T08:05:00Z')).timeEt, '04:05'); // EDT (UTC-4)
  });
  it('reports the ET date and weekday', () => {
    const c = easternClockAt(new Date('2026-11-25T03:30:00Z'));
    assert.deepEqual(c, { dateEt: '2026-11-24', timeEt: '22:30', weekday: 'Tue' });
  });
  it('easternDateOf uses ET, not UTC', () => {
    assert.equal(easternDateOf('2026-11-25T03:30:00Z'), '2026-11-24');
  });
});
