import fs from 'fs';
import path from 'path';
import type { EasternClock } from './easternClock.ts';

/**
 * Trading calendar sourced from the Chronos service (`GET /calendar`), which uses
 * pandas-market-calendars (NASDAQ). Sessions - including early closes - come from
 * that maintained library rather than a hand-written holiday list.
 *
 * The result is cached on disk so a service outage at 04:05 ET does not block the
 * run. If the date is not covered by any calendar data we fail OPEN to a plain
 * weekday rule: running on a holiday is harmless, silently skipping a real
 * trading day is not.
 */

export interface CalendarSession {
  /** Regular-session close in ET, HH:MM (13:00 on early-close days). */
  close_et: string;
  early_close: boolean;
}

export interface MarketCalendarData {
  source: string;
  fetched_at: string;
  /** Inclusive range for which `sessions` is authoritative. */
  coverage_start: string;
  coverage_end: string;
  sessions: Record<string, CalendarSession>;
}

export interface TradingDayInfo {
  isTradingDay: boolean;
  earlyClose: boolean;
  closeEt: string | null;
  /** 'calendar' when the date was covered; 'weekday_fallback' otherwise. */
  basis: 'calendar' | 'weekday_fallback';
}

export function resolveTradingDay(
  clock: Pick<EasternClock, 'dateEt' | 'weekday'>,
  calendar: MarketCalendarData | null
): TradingDayInfo {
  if (calendar && clock.dateEt >= calendar.coverage_start && clock.dateEt <= calendar.coverage_end) {
    const session = calendar.sessions[clock.dateEt];
    return {
      isTradingDay: Boolean(session),
      earlyClose: session?.early_close ?? false,
      closeEt: session?.close_et ?? null,
      basis: 'calendar',
    };
  }
  const weekend = clock.weekday === 'Sat' || clock.weekday === 'Sun';
  return { isTradingDay: !weekend, earlyClose: false, closeEt: null, basis: 'weekday_fallback' };
}

export function calendarCovers(calendar: MarketCalendarData | null, dateEt: string): boolean {
  return Boolean(calendar && dateEt >= calendar.coverage_start && dateEt <= calendar.coverage_end);
}

export function parseCalendarResponse(raw: unknown, fetchedAt: string): MarketCalendarData {
  const body = raw as {
    source?: unknown;
    start?: unknown;
    end?: unknown;
    sessions?: unknown;
  };
  if (
    !body ||
    typeof body.start !== 'string' ||
    typeof body.end !== 'string' ||
    !Array.isArray(body.sessions)
  ) {
    throw new Error('Calendar response is malformed.');
  }
  const sessions: Record<string, CalendarSession> = {};
  for (const entry of body.sessions as Array<Record<string, unknown>>) {
    if (typeof entry?.date !== 'string' || typeof entry?.close_et !== 'string') continue;
    sessions[entry.date] = {
      close_et: entry.close_et,
      early_close: entry.early_close === true,
    };
  }
  return {
    source: typeof body.source === 'string' ? body.source : 'chronos_service',
    fetched_at: fetchedAt,
    coverage_start: body.start,
    coverage_end: body.end,
    sessions,
  };
}

const CACHE_FILE = path.resolve(process.cwd(), 'data', 'market_calendar.json');
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 400;
const LOOKBEHIND_DAYS = 14;

let memory: MarketCalendarData | null = null;
let lastAttemptMs = 0;

function readCache(): MarketCalendarData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as MarketCalendarData;
    return parsed && parsed.sessions && parsed.coverage_start ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data: MarketCalendarData): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch {
    // The cache is an optimisation; failure to persist must not break a run.
  }
}

function addDays(dateEt: string, days: number): string {
  const d = new Date(`${dateEt}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function serviceBaseUrl(): string {
  const configured = process.env.CHRONOS_SERVICE_URL?.trim();
  return (configured || 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

async function fetchFromService(dateEt: string): Promise<MarketCalendarData> {
  const start = addDays(dateEt, -LOOKBEHIND_DAYS);
  const end = addDays(dateEt, LOOKAHEAD_DAYS);
  const headers: Record<string, string> = {};
  if (process.env.CHRONOS_API_TOKEN) headers.Authorization = `Bearer ${process.env.CHRONOS_API_TOKEN}`;
  const res = await fetch(`${serviceBaseUrl()}/calendar?start=${start}&end=${end}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Calendar endpoint returned HTTP ${res.status}.`);
  return parseCalendarResponse(await res.json(), new Date().toISOString());
}

/**
 * Best available calendar for `dateEt`: fresh from the service when due, else the
 * cached copy, else null (caller falls back to weekdays).
 */
export async function getMarketCalendar(dateEt: string): Promise<MarketCalendarData | null> {
  memory ??= readCache();
  const fresh =
    memory !== null &&
    calendarCovers(memory, dateEt) &&
    Date.now() - Date.parse(memory.fetched_at) < REFRESH_AFTER_MS;
  if (fresh) return memory;

  // Do not hammer a down service from the 30s scheduler tick.
  if (Date.now() - lastAttemptMs < 60_000) return memory;
  lastAttemptMs = Date.now();
  try {
    memory = await fetchFromService(dateEt);
    writeCache(memory);
  } catch (err) {
    console.warn(
      `Market calendar refresh failed (${err instanceof Error ? err.message : String(err)}); using ${
        memory ? 'cached calendar' : 'weekday fallback'
      }.`
    );
  }
  return memory;
}

export async function resolveTradingDayNow(clock: EasternClock): Promise<TradingDayInfo> {
  return resolveTradingDay(clock, await getMarketCalendar(clock.dateEt));
}
