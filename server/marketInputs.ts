/**
 * Pre-market inputs that are observable at ~4:20am ET from free sources:
 *
 * - True overnight index-futures change: latest 1-minute futures price versus the
 *   futures price at the cash close (normally 4:00pm ET, the end of CME's 30-second
 *   settlement window) of the last completed session. Yahoo futures quotes are
 *   roughly 10 minutes delayed.
 * - Overnight VIX: Cboe disseminates VIX from 3:15am ET; Yahoo's 1-minute chart
 *   (includePrePost=true) carries those bars roughly 15 minutes delayed.
 * - Cboe daily index CSVs (VIX, VIX9D, VIX3M, VXN, RVX, ...), posted ~5:30pm ET the
 *   same day. Only the CLOSE column is used: OPEN for VIX is the 3:15am overnight
 *   print, and intraday LOW values can contain bad prints.
 *
 * These values are for the snapshot and display only. They must NOT be fed to
 * Chronos-2 as covariates: no history exists at the same 4:20am clock time
 * (Yahoo keeps ~7 days of 1-minute data), so training on them would be look-ahead.
 *
 * Everything below the fetch helpers is pure so it can be unit tested offline.
 */
import type { InputObservation, InputObservationSource } from '../src/types/forecast.ts';

export interface IntradayBar {
  /** Unix seconds as reported by Yahoo (bar start; the final element may be a live quote time). */
  ts: number;
  dateEt: string; // YYYY-MM-DD
  hhmmEt: string; // HH:MM, 24h
  close: number;
}

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
}

export function toEasternDateAndTime(unixSeconds: number): { dateEt: string; hhmmEt: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    dateEt: `${get('year')}-${get('month')}-${get('day')}`,
    hhmmEt: `${hour}:${get('minute')}`,
  };
}

export function isoFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function hhmmMinus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

interface YahooChartJson {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

/** Parse a Yahoo v8 chart response into 1-minute bars with a finite, positive close. */
export function parseYahooMinuteChart(json: unknown): IntradayBar[] {
  const result = (json as YahooChartJson)?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const bars: IntradayBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ ts: timestamps[i], ...toEasternDateAndTime(timestamps[i]), close });
  }
  return bars.sort((a, b) => a.ts - b.ts);
}

/**
 * Parse a Cboe `{SYM}_History.csv` file (DATE,OPEN,HIGH,LOW,CLOSE with MM/DD/YYYY
 * dates) into CLOSE values only. Rows without a finite positive close are dropped.
 */
export function parseCboeDailyCsv(text: string): DailyClose[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const dateIdx = header.indexOf('DATE');
  const closeIdx = header.indexOf('CLOSE');
  if (dateIdx < 0 || closeIdx < 0) {
    throw new Error(`Cboe CSV is missing DATE/CLOSE columns (header: ${lines[0].slice(0, 80)})`);
  }
  const byDate = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((cells[dateIdx] ?? '').trim());
    const close = Number(cells[closeIdx]);
    if (!match || !Number.isFinite(close) || close <= 0) continue;
    const date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    byDate.set(date, close);
  }
  return Array.from(byDate, ([date, close]) => ({ date, close })).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

export interface OvernightFuturesChange {
  change_pct: number | null;
  latest: IntradayBar | null;
  reference: IntradayBar | null;
  reason?: string;
}

/**
 * True overnight futures change: latest bar close / close of the last bar before
 * the cash close on `sessionDate`, minus 1.
 *
 * The reference is the bar starting one minute before the close (15:59 ET on a
 * normal day): its close is the price at exactly 4:00:00pm ET, the end of CME's
 * settlement averaging window. If that bar is missing, the latest bar in the ten
 * minutes before the close is used. On early-close days with no bar in that
 * window (futures halt at 1:15pm ET) the change is reported as unavailable rather
 * than measured from the wrong time.
 */
export function computeOvernightFuturesChange(
  bars: IntradayBar[],
  sessionDate: string,
  nowUnix: number,
  options: { closeHhmmEt?: string; maxStaleMinutes?: number } = {}
): OvernightFuturesChange {
  const closeHhmm = options.closeHhmmEt ?? '16:00';
  const maxStale = options.maxStaleMinutes ?? 60;
  const windowStart = hhmmMinus(closeHhmm, 10);
  const candidates = bars.filter(
    (b) => b.dateEt === sessionDate && b.hhmmEt >= windowStart && b.hhmmEt < closeHhmm
  );
  const reference = candidates[candidates.length - 1] ?? null;
  if (!reference) {
    return {
      change_pct: null,
      latest: null,
      reference: null,
      reason: `no futures bar between ${windowStart} and ${closeHhmm} ET on ${sessionDate}`,
    };
  }
  const after = bars.filter(
    (b) => (b.dateEt > sessionDate || (b.dateEt === sessionDate && b.hhmmEt >= closeHhmm)) && b.ts <= nowUnix
  );
  const latest = after[after.length - 1] ?? null;
  if (!latest) {
    return { change_pct: null, latest: null, reference, reason: 'no futures bar after the reference close' };
  }
  const ageMinutes = (nowUnix - latest.ts) / 60;
  if (ageMinutes > maxStale) {
    return {
      change_pct: null,
      latest,
      reference,
      reason: `latest futures bar is ${Math.round(ageMinutes)} minutes old (limit ${maxStale})`,
    };
  }
  return { change_pct: (latest.close / reference.close - 1) * 100, latest, reference };
}

/**
 * Latest overnight VIX print: the last bar on `todayEt` between 03:15 and 09:29 ET,
 * provided `todayEt` is after the base session (so it is newer than the prior close).
 */
export function latestOvernightVix(
  bars: IntradayBar[],
  todayEt: string,
  baseSessionDate: string
): IntradayBar | null {
  if (todayEt <= baseSessionDate) return null;
  const overnight = bars.filter((b) => b.dateEt === todayEt && b.hhmmEt >= '03:15' && b.hhmmEt < '09:30');
  return overnight[overnight.length - 1] ?? null;
}

/**
 * True when an overnight VIX print should be observable: from 03:30 ET (the first
 * 3:15 print plus Yahoo's ~15-minute delay) until the 09:30 ET open, on weekdays.
 * Outside this window a null overnight VIX is expected, not a missing input.
 */
export function overnightVixWindowOpen(et: { weekday: string; timeEt: string }): boolean {
  return et.weekday !== 'Sat' && et.weekday !== 'Sun' && et.timeEt >= '03:30' && et.timeEt < '09:30';
}

/** Closes on or before `asOfDate`, oldest first. */
export function closesThrough(series: DailyClose[], asOfDate: string): DailyClose[] {
  return series.filter((row) => row.date <= asOfDate);
}

/**
 * IV rank from the trailing `window` daily closes ending on the latest close on or
 * before `asOfDate`: (last - min) / (max - min) * 100. Null with fewer than
 * `window` observations or a flat range.
 */
export function ivRankPct(series: DailyClose[], asOfDate: string, window = 252): number | null {
  const tail = closesThrough(series, asOfDate).slice(-window);
  if (tail.length < window) return null;
  const values = tail.map((row) => row.close);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (!(hi > lo)) return null;
  return ((values[values.length - 1] - lo) / (hi - lo)) * 100;
}

export interface DailySeriesCandidate {
  source: InputObservationSource;
  ticker: string;
  series: DailyClose[] | null;
}

export interface ChosenDailySeries {
  source: InputObservationSource;
  ticker: string;
  series: DailyClose[];
  latest: DailyClose;
}

/**
 * Pick the candidate whose latest close on or before `asOfDate` is newest.
 * Earlier candidates win ties, so list the preferred source (Cboe) first.
 */
export function chooseDailySeries(
  candidates: DailySeriesCandidate[],
  asOfDate: string
): ChosenDailySeries | null {
  let best: ChosenDailySeries | null = null;
  for (const candidate of candidates) {
    if (!candidate.series) continue;
    const through = closesThrough(candidate.series, asOfDate);
    const latest = through[through.length - 1];
    if (!latest) continue;
    if (!best || latest.date > best.latest.date) {
      best = { source: candidate.source, ticker: candidate.ticker, series: through, latest };
    }
  }
  return best;
}

export function dailyObservation(
  field: string,
  source: InputObservationSource,
  ticker: string,
  sessionDate: string
): InputObservation {
  return {
    field,
    source,
    ticker,
    kind: 'daily_close',
    observed_at: null,
    session_date: sessionDate,
    reference_observed_at: null,
  };
}

export function intradayObservation(
  field: string,
  ticker: string,
  bar: IntradayBar,
  reference: IntradayBar | null = null
): InputObservation {
  return {
    field,
    source: 'yahoo_chart_1m',
    ticker,
    kind: 'intraday_bar',
    observed_at: isoFromUnix(bar.ts),
    session_date: bar.dateEt,
    reference_observed_at: reference ? isoFromUnix(reference.ts) : null,
  };
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Cboe symbol for each volatility index used by the profiles, with the Yahoo
 * daily ticker to fall back on. ^RVX is no longer served by Yahoo ("symbol may be
 * delisted"), so RVX has no fallback.
 */
export const CBOE_INDEX_SOURCES: Record<string, { cboe: string; yahooFallback: string | null }> = {
  '^VIX': { cboe: 'VIX', yahooFallback: '^VIX' },
  '^VXN': { cboe: 'VXN', yahooFallback: '^VXN' },
  '^RVX': { cboe: 'RVX', yahooFallback: null },
  '^VIX9D': { cboe: 'VIX9D', yahooFallback: '^VIX9D' },
  '^VIX3M': { cboe: 'VIX3M', yahooFallback: '^VIX3M' },
};

export function cboeCsvUrl(cboeSymbol: string): string {
  return `https://cdn-api.cboe.com/api/global/us_indices/daily_prices/${encodeURIComponent(cboeSymbol)}_History.csv`;
}

const CBOE_CACHE = new Map<string, { fetchedAt: number; rows: DailyClose[] }>();
// The files are republished once per day (~5:30pm ET); an hour keeps runs cheap.
const CBOE_CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchCboeDailyCloses(cboeSymbol: string): Promise<DailyClose[]> {
  const cached = CBOE_CACHE.get(cboeSymbol);
  if (cached && Date.now() - cached.fetchedAt < CBOE_CACHE_TTL_MS) return cached.rows;
  const response = await fetch(cboeCsvUrl(cboeSymbol), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Cboe returned HTTP ${response.status} for ${cboeSymbol}`);
  const rows = parseCboeDailyCsv(await response.text());
  if (rows.length === 0) throw new Error(`Cboe CSV for ${cboeSymbol} has no valid CLOSE rows`);
  CBOE_CACHE.set(cboeSymbol, { fetchedAt: Date.now(), rows });
  return rows;
}

export async function fetchYahooMinuteBars(ticker: string, includePrePost: boolean): Promise<IntradayBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=5d&interval=1m&includePrePost=${includePrePost ? 'true' : 'false'}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Yahoo Finance returned HTTP ${response.status} for ${ticker} 1m`);
  return parseYahooMinuteChart(await response.json());
}
