import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calendarCovers,
  parseCalendarResponse,
  resolveTradingDay,
} from '../server/marketCalendar.ts';

const response = {
  source: 'pandas_market_calendars:NASDAQ',
  start: '2026-11-01',
  end: '2028-01-31',
  sessions: [
    { date: '2026-11-25', close_et: '16:00', early_close: false },
    { date: '2026-11-27', close_et: '13:00', early_close: true },
    { date: '2027-12-27', close_et: '16:00', early_close: false },
    { date: '2028-01-03', close_et: '16:00', early_close: false },
    // 2028-01-17 (MLK day) and 2028-01-01 are intentionally absent: holidays.
  ],
};
const calendar = parseCalendarResponse(response, '2026-11-24T00:00:00Z');

describe('resolveTradingDay', () => {
  it('treats exchange holidays as closed even on weekdays', () => {
    const thanksgiving = resolveTradingDay({ dateEt: '2026-11-26', weekday: 'Thu' }, calendar);
    assert.equal(thanksgiving.isTradingDay, false);
    assert.equal(thanksgiving.basis, 'calendar');
  });

  it('knows holidays beyond the old hard-coded list (2028)', () => {
    const mlk = resolveTradingDay({ dateEt: '2028-01-17', weekday: 'Mon' }, calendar);
    assert.equal(mlk.isTradingDay, false);
    assert.equal(resolveTradingDay({ dateEt: '2028-01-03', weekday: 'Mon' }, calendar).isTradingDay, true);
  });

  it('reports early closes', () => {
    const dayAfter = resolveTradingDay({ dateEt: '2026-11-27', weekday: 'Fri' }, calendar);
    assert.equal(dayAfter.isTradingDay, true);
    assert.equal(dayAfter.earlyClose, true);
    assert.equal(dayAfter.closeEt, '13:00');
  });

  it('closes weekends even if a calendar lists nothing', () => {
    assert.equal(resolveTradingDay({ dateEt: '2026-11-28', weekday: 'Sat' }, calendar).isTradingDay, false);
  });

  it('fails open to a weekday rule when no calendar covers the date', () => {
    const monday = resolveTradingDay({ dateEt: '2030-01-14', weekday: 'Mon' }, calendar);
    assert.deepEqual(monday, { isTradingDay: true, earlyClose: false, closeEt: null, basis: 'weekday_fallback' });
    assert.equal(resolveTradingDay({ dateEt: '2026-11-24', weekday: 'Tue' }, null).basis, 'weekday_fallback');
    assert.equal(resolveTradingDay({ dateEt: '2026-11-22', weekday: 'Sun' }, null).isTradingDay, false);
  });
});

describe('parseCalendarResponse / calendarCovers', () => {
  it('rejects malformed payloads', () => {
    assert.throws(() => parseCalendarResponse({ sessions: 'x' }, 'now'));
  });
  it('checks coverage bounds inclusively', () => {
    assert.equal(calendarCovers(calendar, '2026-11-01'), true);
    assert.equal(calendarCovers(calendar, '2028-01-31'), true);
    assert.equal(calendarCovers(calendar, '2028-02-01'), false);
    assert.equal(calendarCovers(null, '2026-11-01'), false);
  });
});
