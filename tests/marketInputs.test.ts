import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseDailySeries,
  computeOvernightFuturesChange,
  ivRankPct,
  latestOvernightVix,
  overnightVixWindowOpen,
  parseCboeDailyCsv,
  parseYahooMinuteChart,
  toEasternDateAndTime,
  type DailyClose,
  type IntradayBar,
} from '../server/marketInputs.ts';

/** Unix seconds for a wall-clock time in America/New_York (EST, UTC-5, in late November). */
function etUnix(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00-05:00`) / 1000;
}

function bar(date: string, hhmm: string, close: number): IntradayBar {
  const ts = etUnix(date, hhmm);
  return { ts, ...toEasternDateAndTime(ts), close };
}

// Prices recorded from Yahoo 1-minute NQ=F and ^VIX bars around 2026-11-20..23.
const NQ_BARS: IntradayBar[] = [
  bar('2026-11-20', '15:58', 25044.75),
  bar('2026-11-20', '15:59', 25142.0), // close = price at 16:00:00 ET
  bar('2026-11-20', '16:00', 25232.5),
  bar('2026-11-20', '16:14', 25245.0),
  bar('2026-11-23', '03:15', 25896.25),
  bar('2026-11-23', '04:20', 26074.25),
  bar('2026-11-23', '04:21', 26080.0),
];

const VIX_BARS: IntradayBar[] = [
  bar('2026-11-20', '15:59', 39.53),
  bar('2026-11-20', '16:14', 35.89),
  bar('2026-11-23', '03:15', 31.37),
  bar('2026-11-23', '04:20', 30.09),
  bar('2026-11-23', '09:30', 29.5),
];

describe('overnight futures change', () => {
  it('measures the latest bar against the 15:59 ET bar of the base session', () => {
    const now = etUnix('2026-11-23', '04:20');
    const result = computeOvernightFuturesChange(NQ_BARS, '2026-11-20', now);
    assert.equal(result.reference?.hhmmEt, '15:59');
    assert.equal(result.latest?.hhmmEt, '04:20');
    assert.ok(result.change_pct !== null);
    assert.ok(Math.abs(result.change_pct - (26074.25 / 25142.0 - 1) * 100) < 1e-9);
  });

  it('ignores bars after the snapshot time', () => {
    const result = computeOvernightFuturesChange(NQ_BARS, '2026-11-20', etUnix('2026-11-23', '04:20'));
    assert.notEqual(result.latest?.close, 26080.0);
  });

  it('falls back to the latest bar within ten minutes of the close', () => {
    const bars = NQ_BARS.filter((b) => b.hhmmEt !== '15:59');
    const result = computeOvernightFuturesChange(bars, '2026-11-20', etUnix('2026-11-23', '04:20'));
    assert.equal(result.reference?.hhmmEt, '15:58');
  });

  it('returns null rather than a wrong reference when no bar precedes the close', () => {
    // Early close: futures halt at 13:15 ET, so nothing lands in 15:50-15:59.
    const bars = [bar('2026-11-27', '13:14', 26000), bar('2026-11-30', '04:20', 26100)];
    const result = computeOvernightFuturesChange(bars, '2026-11-27', etUnix('2026-11-30', '04:20'));
    assert.equal(result.change_pct, null);
    assert.match(result.reason ?? '', /no futures bar between 15:50 and 16:00/);
  });

  it('honours an early cash close when one is supplied', () => {
    const bars = [bar('2026-11-27', '12:59', 26000), bar('2026-11-30', '04:20', 26260)];
    const result = computeOvernightFuturesChange(bars, '2026-11-27', etUnix('2026-11-30', '04:20'), {
      closeHhmmEt: '13:00',
    });
    assert.ok(Math.abs((result.change_pct ?? 0) - 1) < 1e-9);
  });

  it('rejects a stale latest bar', () => {
    const result = computeOvernightFuturesChange(NQ_BARS, '2026-11-20', etUnix('2026-11-23', '06:00'));
    assert.equal(result.change_pct, null);
    assert.match(result.reason ?? '', /minutes old/);
  });
});

describe('overnight VIX', () => {
  it('returns the latest print between 03:15 and 09:29 ET on the morning after the base session', () => {
    const latest = latestOvernightVix(VIX_BARS, '2026-11-23', '2026-11-20');
    assert.equal(latest?.hhmmEt, '04:20');
    assert.equal(latest?.close, 30.09);
  });

  it('returns null when today is the base session (the prints predate the prior close)', () => {
    assert.equal(latestOvernightVix(VIX_BARS, '2026-11-23', '2026-11-23'), null);
  });

  it('only expects a print from 03:30 ET to the open on weekdays', () => {
    assert.equal(overnightVixWindowOpen({ weekday: 'Mon', timeEt: '04:20' }), true);
    assert.equal(overnightVixWindowOpen({ weekday: 'Mon', timeEt: '03:20' }), false);
    assert.equal(overnightVixWindowOpen({ weekday: 'Mon', timeEt: '09:30' }), false);
    assert.equal(overnightVixWindowOpen({ weekday: 'Sat', timeEt: '04:20' }), false);
  });
});

describe('Yahoo and Cboe parsing', () => {
  it('drops null and non-positive closes from Yahoo minute charts', () => {
    const json = {
      chart: {
        result: [
          {
            timestamp: [etUnix('2026-11-24', '04:19'), etUnix('2026-11-24', '04:20'), etUnix('2026-11-24', '04:21')],
            indicators: { quote: [{ close: [27.3, null, 0] }] },
          },
        ],
      },
    };
    const bars = parseYahooMinuteChart(json);
    assert.deepEqual(
      bars.map((b) => [b.dateEt, b.hhmmEt, b.close]),
      [['2026-11-24', '04:19', 27.3]]
    );
  });

  it('reads only CLOSE from Cboe CSVs, ignoring the overnight OPEN and bad LOW prints', () => {
    const csv = [
      'DATE,OPEN,HIGH,LOW,CLOSE',
      '11/20/2026,28.630000,40.030000,26.940000,35.890000',
      '11/23/2026,31.380000,35.080000,15.390000,26.620000',
      '11/24/2026,,,,',
    ].join('\n');
    assert.deepEqual(parseCboeDailyCsv(csv), [
      { date: '2026-11-20', close: 35.89 },
      { date: '2026-11-23', close: 26.62 },
    ]);
  });

  it('rejects a CSV without DATE/CLOSE columns', () => {
    assert.throws(() => parseCboeDailyCsv('DATE,VVIX\n11/23/2026,120.1'), /DATE\/CLOSE/);
  });
});

describe('IV rank and source selection', () => {
  const series: DailyClose[] = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close: 10 + (i % 50),
  }));

  it('ranks the last close within the trailing 252 closes', () => {
    const asOf = series[299].date; // close 10 + 299 % 50 = 59, the max
    assert.equal(ivRankPct(series, asOf), 100);
    const nearLow = series[251].date; // close 11; trailing window spans 10..59
    assert.equal(ivRankPct(series, nearLow), (1 / 49) * 100);
  });

  it('excludes closes after the base session', () => {
    const asOf = series[260].date;
    const tail = series.slice(260 - 251, 261).map((r) => r.close);
    const expected = ((tail[tail.length - 1] - Math.min(...tail)) / (Math.max(...tail) - Math.min(...tail))) * 100;
    assert.equal(ivRankPct(series, asOf), expected);
  });

  it('requires a full window', () => {
    assert.equal(ivRankPct(series.slice(0, 251), series[250].date), null);
  });

  it('prefers Cboe on a tie and falls back to the fresher source otherwise', () => {
    const cboe: DailyClose[] = [{ date: '2026-11-20', close: 40.72 }];
    const yahoo: DailyClose[] = [
      { date: '2026-11-20', close: 40.7 },
      { date: '2026-11-23', close: 27.76 },
    ];
    const stale = chooseDailySeries(
      [
        { source: 'cboe_daily_csv', ticker: 'VIX9D', series: cboe },
        { source: 'yahoo_chart_1d', ticker: '^VIX9D', series: yahoo },
      ],
      '2026-11-23'
    );
    assert.equal(stale?.source, 'yahoo_chart_1d');
    const tie = chooseDailySeries(
      [
        { source: 'cboe_daily_csv', ticker: 'VIX9D', series: cboe },
        { source: 'yahoo_chart_1d', ticker: '^VIX9D', series: yahoo },
      ],
      '2026-11-20'
    );
    assert.equal(tie?.source, 'cboe_daily_csv');
    assert.equal(chooseDailySeries([{ source: 'cboe_daily_csv', ticker: 'RVX', series: null }], '2026-11-23'), null);
  });
});
