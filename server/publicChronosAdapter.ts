import crypto from 'crypto';
import type {
  CalibrationMode,
  ExecutionSignals,
  ForecastPayload,
  ForecastRecord,
  GroundingSource,
  HorizonForecast,
  HorizonKey,
  InputObservation,
  MarketSnapshot,
  RealizedVerification,
  RunWindow,
} from '../src/types/forecast.ts';
import { FORECAST_SCHEMA_VERSION } from '../src/types/forecast.ts';
import {
  auditAndReconcileForecast,
  buildExpectedBins,
  getBinWidthForSymbol,
  HORIZON_SPECS,
} from './mathAudit.ts';
import {
  CBOE_INDEX_SOURCES,
  chooseDailySeries,
  computeOvernightFuturesChange,
  dailyObservation,
  fetchCboeDailyCloses,
  fetchYahooMinuteBars,
  intradayObservation,
  ivRankPct,
  latestOvernightVix,
  overnightVixWindowOpen,
  toEasternDateAndTime,
  type DailyClose,
  type DailySeriesCandidate,
} from './marketInputs.ts';

export const DEFAULT_PUBLIC_CHRONOS_URL = 'https://equinai-chronos-2-api.hf.space';

export function getPublicChronosUrl(): string {
  return (process.env.PUBLIC_CHRONOS_SERVICE_URL ?? DEFAULT_PUBLIC_CHRONOS_URL).replace(
    /\/+$/,
    ''
  );
}

interface DailyBar {
  date: string; // YYYY-MM-DD in America/New_York
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MinuteBar {
  ts: number;
  dateEt: string;
  hhmmEt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CacheEntry {
  fetchedAt: number;
  bars: DailyBar[];
}

const HISTORY_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const PROFILE_MAP: Record<
  string,
  { underlying: string; leverage: number; volatility: string; futures: string }
> = {
  TQQQ: { underlying: 'QQQ', leverage: 3, volatility: '^VXN', futures: 'NQ=F' },
  SQQQ: { underlying: 'QQQ', leverage: 3, volatility: '^VXN', futures: 'NQ=F' },
  QLD: { underlying: 'QQQ', leverage: 2, volatility: '^VXN', futures: 'NQ=F' },
  QID: { underlying: 'QQQ', leverage: 2, volatility: '^VXN', futures: 'NQ=F' },
  QQQ: { underlying: 'QQQ', leverage: 1, volatility: '^VXN', futures: 'NQ=F' },
  UPRO: { underlying: 'SPY', leverage: 3, volatility: '^VIX', futures: 'ES=F' },
  SPXU: { underlying: 'SPY', leverage: 3, volatility: '^VIX', futures: 'ES=F' },
  SSO: { underlying: 'SPY', leverage: 2, volatility: '^VIX', futures: 'ES=F' },
  SPY: { underlying: 'SPY', leverage: 1, volatility: '^VIX', futures: 'ES=F' },
  SOXL: { underlying: 'SOXX', leverage: 3, volatility: '^VXN', futures: 'NQ=F' },
  SOXS: { underlying: 'SOXX', leverage: 3, volatility: '^VXN', futures: 'NQ=F' },
  TNA: { underlying: 'IWM', leverage: 3, volatility: '^RVX', futures: 'RTY=F' },
};

function getEasternNow(): {
  dateEt: string;
  timeEt: string;
  weekday: string;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);

  return {
    dateEt: `${get('year')}-${get('month')}-${get('day')}`,
    timeEt: `${hour}:${get('minute')}`,
    weekday,
  };
}

function getSessionPhase(et: { weekday: string; timeEt: string }): string {
  if (et.weekday === 'Sat' || et.weekday === 'Sun') return 'closed';
  if (et.timeEt < '04:00') return 'closed';
  if (et.timeEt < '09:30') return 'pre_market';
  if (et.timeEt < '16:00') return 'regular_open';
  if (et.timeEt < '20:00') return 'after_hours';
  return 'closed';
}

function countWeekdaysBetween(startDateIso: string, endDateIso: string): number {
  const start = new Date(`${startDateIso}T12:00:00Z`);
  const end = new Date(`${endDateIso}T12:00:00Z`);
  let count = 0;
  const cursor = new Date(start.getTime() + 86_400_000);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

async function fetchYahooDailyBars(ticker: string): Promise<DailyBar[]> {
  const cached = HISTORY_CACHE.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.bars;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=5y&interval=1d&events=history`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned HTTP ${response.status} for ${ticker}`);
  }
  const data = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };

  const result = data.chart?.result?.[0];
  if (!result || !result.timestamp?.length) {
    throw new Error(data.chart?.error?.description || `No daily history returned for ${ticker}`);
  }

  const quote = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const byDate = new Map<string, DailyBar>();

  for (let i = 0; i < result.timestamp.length; i++) {
    const ts = result.timestamp[i];
    const rawClose = quote?.close?.[i];
    const adjClose = adj?.[i];
    const close = adjClose ?? rawClose;
    if (close === null || close === undefined || !Number.isFinite(close) || close <= 0) {
      continue;
    }

    const ratio = rawClose && rawClose > 0 ? close / rawClose : 1;
    const open = (quote?.open?.[i] ?? rawClose ?? close) * ratio;
    const high = (quote?.high?.[i] ?? rawClose ?? close) * ratio;
    const low = (quote?.low?.[i] ?? rawClose ?? close) * ratio;
    const volume = quote?.volume?.[i] ?? 0;

    const { dateEt } = toEasternDateAndTime(ts);
    byDate.set(dateEt, {
      date: dateEt,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: Number.isFinite(volume ?? 0) ? Number(volume ?? 0) : 0,
    });
  }

  const bars = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length === 0) {
    throw new Error(`No valid closing prices returned for ${ticker}`);
  }
  HISTORY_CACHE.set(ticker, { fetchedAt: Date.now(), bars });
  return bars;
}

async function fetchPremarketTape(
  symbol: string,
  et: { dateEt: string; timeEt: string; weekday: string },
  prevClose: number
): Promise<{
  premarket_open_4am: number | null;
  premarket_30m_high: number | null;
  premarket_30m_low: number | null;
  premarket_30m_change_pct: number | null;
  premarket_30m_volume: number | null;
  pre_market_or_latest_price: number | null;
  pre_market_change_pct: number | null;
  missing: string[];
  observations: InputObservation[];
}> {
  const empty = {
    premarket_open_4am: null,
    premarket_30m_high: null,
    premarket_30m_low: null,
    premarket_30m_change_pct: null,
    premarket_30m_volume: null,
    pre_market_or_latest_price: null,
    pre_market_change_pct: null,
    missing: [] as string[],
    observations: [] as InputObservation[],
  };

  if (et.weekday === 'Sat' || et.weekday === 'Sun' || et.timeEt < '04:00' || et.timeEt >= '09:30') {
    return empty;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=5d&interval=1m&includePrePost=true`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      empty.missing.push('Premarket minute tape is unavailable from Yahoo Finance.');
      return empty;
    }

    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!timestamps.length || !quote) {
      empty.missing.push('Premarket minute tape is unavailable from Yahoo Finance.');
      return empty;
    }

    const minuteBars: MinuteBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = quote.close?.[i];
      if (c === null || c === undefined || !Number.isFinite(c)) continue;
      const { dateEt, hhmmEt } = toEasternDateAndTime(timestamps[i]);
      if (dateEt !== et.dateEt) continue;
      minuteBars.push({
        ts: timestamps[i],
        dateEt,
        hhmmEt,
        open: quote.open?.[i] ?? c,
        high: quote.high?.[i] ?? c,
        low: quote.low?.[i] ?? c,
        close: c,
        volume: quote.volume?.[i] ?? 0,
      });
    }

    const pre = minuteBars.filter((b) => b.hhmmEt >= '04:00' && b.hhmmEt <= '09:29');
    const opening = minuteBars.filter((b) => b.hhmmEt >= '04:00' && b.hhmmEt <= '04:29');

    if (pre.length === 0) {
      empty.missing.push('Premarket minute tape is unavailable from Yahoo Finance.');
      return empty;
    }

    const latestBar = pre[pre.length - 1];
    const latest = latestBar.close;
    const changePct = prevClose > 0 ? ((latest / prevClose - 1) * 100) : null;
    const latestObservations = [
      intradayObservation('pre_market_or_latest_price', symbol, latestBar),
      intradayObservation('pre_market_change_pct', symbol, latestBar),
    ];

    if (opening.length > 0) {
      const open4am = opening[0].open;
      const last30m = opening[opening.length - 1].close;
      const high30m = Math.max(...opening.map((b) => b.high));
      const low30m = Math.min(...opening.map((b) => b.low));
      const vol30m = opening.reduce((acc, b) => acc + (b.volume || 0), 0);
      return {
        premarket_open_4am: open4am,
        premarket_30m_high: high30m,
        premarket_30m_low: low30m,
        premarket_30m_change_pct: open4am > 0 ? (last30m / open4am - 1) * 100 : null,
        premarket_30m_volume: vol30m,
        pre_market_or_latest_price: latest,
        pre_market_change_pct: changePct,
        missing: [],
        observations: [
          ...latestObservations,
          intradayObservation('premarket_open_4am', symbol, opening[0]),
          intradayObservation('premarket_30m_change_pct', symbol, opening[opening.length - 1], opening[0]),
        ],
      };
    }

    return {
      ...empty,
      pre_market_or_latest_price: latest,
      pre_market_change_pct: changePct,
      observations: latestObservations,
    };
  } catch {
    empty.missing.push('Premarket minute tape is unavailable from Yahoo Finance.');
    return empty;
  }
}

function lastCompleteBars(bars: DailyBar[], et: { dateEt: string; timeEt: string }): DailyBar[] {
  if (et.timeEt < '16:10') {
    return bars.filter((b) => b.date < et.dateEt);
  }
  return bars;
}

interface PremarketMarketInputs {
  overnight_futures_change_pct: number | null;
  vix_overnight_level: number | null;
  vix9d_level: number | null;
  vix3m_level: number | null;
  rvx_level: number | null;
  /** Close of the profile's volatility index (VIX, VXN or RVX) on or before the base session. */
  primary_volatility_level: number | null;
  iv_rank_pct: number | null;
  observations: InputObservation[];
  missing: string[];
  notes: string[];
}

function settledMessage(result: PromiseSettledResult<unknown>): string {
  return result.status === 'rejected'
    ? result.reason instanceof Error
      ? result.reason.message
      : String(result.reason)
    : '';
}

/**
 * Inputs observable at ~4:20am ET that the daily bars cannot supply. Each fetch is
 * best-effort: a failure leaves the field null and lists it in missing_inputs,
 * but never fails the forecast. None of these feed the model.
 */
async function gatherPremarketMarketInputs(
  profile: { volatility: string; futures: string },
  et: { dateEt: string; timeEt: string; weekday: string },
  baseSessionDate: string,
  yahooDaily: Map<string, DailyBar[]>
): Promise<PremarketMarketInputs> {
  const out: PremarketMarketInputs = {
    overnight_futures_change_pct: null,
    vix_overnight_level: null,
    vix9d_level: null,
    vix3m_level: null,
    rvx_level: null,
    primary_volatility_level: null,
    iv_rank_pct: null,
    observations: [],
    missing: [],
    notes: [],
  };
  const nowUnix = Math.floor(Date.now() / 1000);
  const wantOvernightVix = overnightVixWindowOpen(et);

  // 1. True overnight futures change and overnight VIX from Yahoo 1-minute bars.
  const [futuresResult, vixResult] = await Promise.allSettled([
    fetchYahooMinuteBars(profile.futures, false),
    wantOvernightVix ? fetchYahooMinuteBars('^VIX', true) : Promise.resolve([]),
  ]);

  if (futuresResult.status === 'fulfilled') {
    const change = computeOvernightFuturesChange(futuresResult.value, baseSessionDate, nowUnix);
    if (change.change_pct !== null && change.latest && change.reference) {
      out.overnight_futures_change_pct = change.change_pct;
      out.observations.push(
        intradayObservation('overnight_futures_change_pct', profile.futures, change.latest, change.reference)
      );
    } else {
      out.notes.push(`Overnight ${profile.futures} change unavailable: ${change.reason}.`);
    }
  } else {
    out.notes.push(`Overnight ${profile.futures} 1-minute bars unavailable: ${settledMessage(futuresResult)}.`);
  }
  if (out.overnight_futures_change_pct === null) out.missing.push('true_overnight_futures_change_pct');

  if (wantOvernightVix) {
    const bar = vixResult.status === 'fulfilled' ? latestOvernightVix(vixResult.value, et.dateEt, baseSessionDate) : null;
    if (bar) {
      out.vix_overnight_level = bar.close;
      out.observations.push(intradayObservation('vix_overnight_level', '^VIX', bar));
    } else {
      out.missing.push('vix_overnight_level');
      if (vixResult.status === 'rejected') {
        out.notes.push(`Overnight ^VIX 1-minute bars unavailable: ${settledMessage(vixResult)}.`);
      }
    }
  }

  // 2. Cboe daily CSV closes, falling back to Yahoo daily history where it exists.
  const indexKeys = Array.from(new Set(['^VIX9D', '^VIX3M', profile.volatility])).filter(
    (key) => key in CBOE_INDEX_SOURCES
  );
  const cboeResults = await Promise.allSettled(
    indexKeys.map((key) => fetchCboeDailyCloses(CBOE_INDEX_SOURCES[key].cboe))
  );
  const yahooAsCloses = async (ticker: string): Promise<DailyClose[] | null> => {
    try {
      const bars = yahooDaily.get(ticker) ?? (await fetchYahooDailyBars(ticker));
      return bars.map((b) => ({ date: b.date, close: b.close }));
    } catch {
      return null;
    }
  };

  const chosen = new Map<string, NonNullable<ReturnType<typeof chooseDailySeries>>>();
  for (let i = 0; i < indexKeys.length; i++) {
    const key = indexKeys[i];
    const { cboe, yahooFallback } = CBOE_INDEX_SOURCES[key];
    const cboeResult = cboeResults[i];
    const candidates: DailySeriesCandidate[] = [
      { source: 'cboe_daily_csv', ticker: cboe, series: cboeResult.status === 'fulfilled' ? cboeResult.value : null },
    ];
    const cboeChoice = chooseDailySeries(candidates, baseSessionDate);
    // Only consult Yahoo when Cboe failed or has not posted the base session yet.
    if (yahooFallback && (!cboeChoice || cboeChoice.latest.date < baseSessionDate)) {
      candidates.push({ source: 'yahoo_chart_1d', ticker: yahooFallback, series: await yahooAsCloses(yahooFallback) });
    }
    if (cboeResult.status === 'rejected') {
      out.notes.push(`Cboe ${cboe} CSV unavailable: ${settledMessage(cboeResult)}.`);
    }
    const pick = chooseDailySeries(candidates, baseSessionDate);
    if (!pick) continue;
    if (pick.latest.date < baseSessionDate) {
      out.missing.push(`${cboe} close is from ${pick.latest.date}, older than base session ${baseSessionDate}`);
    }
    chosen.set(key, pick);
  }

  const assign = (key: string, field: 'vix9d_level' | 'vix3m_level' | 'rvx_level') => {
    const pick = chosen.get(key);
    if (pick) {
      out[field] = pick.latest.close;
      out.observations.push(dailyObservation(field, pick.source, pick.ticker, pick.latest.date));
    } else {
      out.missing.push(field);
    }
  };
  assign('^VIX9D', 'vix9d_level');
  assign('^VIX3M', 'vix3m_level');
  if (profile.volatility === '^RVX') assign('^RVX', 'rvx_level');

  const primary = chosen.get(profile.volatility);
  if (primary) {
    out.primary_volatility_level = primary.latest.close;
    out.iv_rank_pct = ivRankPct(primary.series, baseSessionDate);
    if (out.iv_rank_pct !== null) {
      out.observations.push(dailyObservation('iv_rank_pct', primary.source, primary.ticker, primary.latest.date));
    }
  }
  if (out.iv_rank_pct === null) out.missing.push('iv_rank_pct');

  return out;
}

function logReturnsPct(bars: DailyBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    out.push(Math.log(bars[i].close / bars[i - 1].close) * 100);
  }
  return out;
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function buildStandardizedResiduals(returnsPct: number[]): {
  residuals: number[];
  recentSigma: number;
} {
  const residuals: number[] = [];
  let lastSigma = 1.0;

  for (let i = 19; i < returnsPct.length; i++) {
    const win = returnsPct.slice(i - 19, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const variance =
      win.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, win.length - 1);
    const sigma = Math.max(Math.sqrt(variance), 1e-6);
    lastSigma = sigma;
    const z = (returnsPct[i] - mean) / sigma;
    if (Number.isFinite(z)) residuals.push(z);
  }

  return { residuals, recentSigma: lastSigma };
}

interface PublicChronosPredictResponse {
  model_id: string;
  predictions: Array<{
    step: number;
    pred_price: number;
    pred_confidence: number;
  }>;
}

export interface PublicHealthStatus {
  reachable: boolean;
  model_loaded: boolean;
  model_id: string;
  device: string;
  backend?: string;
  url: string;
  mode: 'public_hf_space';
  data_provider: string;
  context_length: number;
  max_horizon_step: number;
  simulations: number;
  direct_horizon_limit: number;
  error?: string;
}

export async function probePublicChronosHealth(): Promise<PublicHealthStatus> {
  const url = getPublicChronosUrl();
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return {
        reachable: false,
        model_loaded: false,
        model_id: 'amazon/chronos-2',
        device: 'cpu',
        url,
        mode: 'public_hf_space',
        data_provider: 'Yahoo Finance chart API + Public Hugging Face Chronos-2 Space',
        context_length: 512,
        max_horizon_step: 288,
        simulations: 10000,
        direct_horizon_limit: 288,
        error: `Public Chronos-2 service returned HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      status?: string;
      model?: string;
      backend?: string;
      device?: string;
      ready?: boolean;
      max_context_length?: number;
      max_horizon_step?: number;
    };
    return {
      reachable: true,
      model_loaded: data.ready === true && data.status === 'ok',
      model_id: data.model ?? 'amazon/chronos-2',
      device: data.device ?? 'cpu',
      backend: data.backend ?? 'hf_cpu',
      url,
      mode: 'public_hf_space',
      data_provider: 'Yahoo Finance chart API + Public Hugging Face Chronos-2 Space',
      context_length: data.max_context_length ?? 512,
      max_horizon_step: data.max_horizon_step ?? 288,
      simulations: 10000,
      direct_horizon_limit: data.max_horizon_step ?? 288,
    };
  } catch (err) {
    return {
      reachable: false,
      model_loaded: false,
      model_id: 'amazon/chronos-2',
      device: 'cpu',
      url,
      mode: 'public_hf_space',
      data_provider: 'Yahoo Finance chart API + Public Hugging Face Chronos-2 Space',
      context_length: 512,
      max_horizon_step: 288,
      simulations: 10000,
      direct_horizon_limit: 288,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildDistributionForOutcomes(
  outcomesPct: number[],
  spec: { key: HorizonKey; label: string; trading_days: number },
  binWidthPct: number
): HorizonForecast {
  const templateBins = buildExpectedBins(binWidthPct);
  const firstMin = templateBins[0].min_pct;
  const lastMax = templateBins[templateBins.length - 1].max_pct;

  let underflowCount = 0;
  let overflowCount = 0;
  const counts = new Array<number>(templateBins.length).fill(0);

  for (const val of outcomesPct) {
    if (val < firstMin) {
      underflowCount++;
    } else if (val >= lastMax) {
      overflowCount++;
    } else {
      const idx = Math.min(
        templateBins.length - 1,
        Math.max(0, Math.floor((val - firstMin) / binWidthPct))
      );
      counts[idx]++;
    }
  }

  const total = Math.max(1, outcomesPct.length);
  const underflow = underflowCount / total;
  const overflow = overflowCount / total;

  let runningCdf = underflow;
  const bins = templateBins.map((tpl, idx) => {
    const prob = counts[idx] / total;
    runningCdf += prob;
    return {
      min_pct: tpl.min_pct,
      max_pct: tpl.max_pct,
      prob,
      cdf: runningCdf,
    };
  });

  const sorted = [...outcomesPct].sort((a, b) => a - b);
  const mean = outcomesPct.reduce((a, b) => a + b, 0) / total;
  const variance =
    outcomesPct.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, total - 1);
  const std = Math.sqrt(variance);
  const probPos = outcomesPct.filter((v) => v > 0).length / total;

  const p01 = quantileSorted(sorted, 0.01);
  const p05 = quantileSorted(sorted, 0.05);
  const p25 = quantileSorted(sorted, 0.25);
  const p50 = quantileSorted(sorted, 0.5);
  const p75 = quantileSorted(sorted, 0.75);
  const p95 = quantileSorted(sorted, 0.95);
  const p99 = quantileSorted(sorted, 0.99);

  const tail = sorted.filter((v) => v <= p05);
  const es5 = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : p05;

  return {
    label: spec.label,
    trading_days: spec.trading_days,
    bin_width_pct: binWidthPct,
    underflow_prob: underflow,
    overflow_prob: overflow,
    bins,
    summary: {
      mean_pct: mean,
      median_pct: p50,
      std_pct: std,
      prob_positive: probPos,
      expected_shortfall_5pct: es5,
      quantiles_pct: { p01, p05, p25, p75, p95, p99 },
    },
  };
}

export async function runPublicChronosPipeline(params: {
  symbol: string;
  calibrationMode: CalibrationMode;
  runWindow: RunWindow;
  trigger: 'manual' | 'scheduled';
  onProgress?: (event: {
    stage: 'retrieval' | 'synthesis' | 'audit' | 'complete';
    message: string;
    snapshot?: MarketSnapshot;
    sources?: GroundingSource[];
  }) => void;
}): Promise<ForecastRecord> {
  const symbol = params.symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '') || 'TQQQ';
  const profile = PROFILE_MAP[symbol] ?? {
    underlying: symbol,
    leverage: 1,
    volatility: '^VIX',
    futures: 'ES=F',
  };
  const publicUrl = getPublicChronosUrl();
  const etNow = getEasternNow();
  const nowUtc = new Date().toISOString();

  params.onProgress?.({
    stage: 'retrieval',
    message: `Fetching completed daily history and market covariates for ${symbol}...`,
  });

  const auxTickers = Array.from(
    new Set([
      symbol,
      profile.underlying,
      'SPY',
      '^VIX',
      '^VXN',
      profile.futures,
      '^TNX',
      'DX-Y.NYB',
      'CL=F',
    ])
  );

  const histories = new Map<string, DailyBar[]>();
  const fetchErrors = new Map<string, string>();

  await Promise.all(
    auxTickers.map(async (ticker) => {
      try {
        const bars = await fetchYahooDailyBars(ticker);
        histories.set(ticker, bars);
      } catch (err) {
        fetchErrors.set(ticker, err instanceof Error ? err.message : String(err));
      }
    })
  );

  const rawTargetBars = histories.get(symbol);
  if (!rawTargetBars) {
    throw new Error(
      `Market data for ${symbol} is unavailable from Yahoo Finance: ${fetchErrors.get(symbol) ?? 'no history returned'}`
    );
  }

  const targetBars = lastCompleteBars(rawTargetBars, etNow);
  if (targetBars.length < 120) {
    throw new Error(
      `Only ${targetBars.length} completed daily bars are available for ${symbol}; at least 120 are required.`
    );
  }

  const lastBar = targetBars[targetBars.length - 1];
  const weekdaysStale = countWeekdaysBetween(lastBar.date, etNow.dateEt);
  if (weekdaysStale > 4) {
    throw new Error(
      `The latest completed daily bar for ${symbol} (${lastBar.date}) is ${weekdaysStale} weekdays old.`
    );
  }

  const basePrice = lastBar.close;
  const closeSeries = targetBars.map((b) => b.close);
  const contextCloses = closeSeries.slice(-512);

  params.onProgress?.({
    stage: 'synthesis',
    message: `Querying public Chronos-2 service (${publicUrl}) across 1D–252D horizons...`,
  });

  const chronosRes = await fetch(`${publicUrl}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      close_prices: contextCloses,
      context_length: contextCloses.length,
      horizons: [1, 5, 21, 63, 252],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!chronosRes.ok) {
    const errText = await chronosRes.text();
    throw new Error(
      `Public Chronos-2 service error (HTTP ${chronosRes.status}): ${errText.slice(0, 300)}`
    );
  }

  const chronosJson = (await chronosRes.json()) as PublicChronosPredictResponse;
  const predMap = new Map<number, { price: number; confidence: number }>();
  for (const item of chronosJson.predictions ?? []) {
    if (Number.isFinite(item.pred_price) && item.pred_price > 0) {
      predMap.set(item.step, {
        price: item.pred_price,
        confidence: item.pred_confidence ?? 0.8,
      });
    }
  }

  if (!predMap.has(1)) {
    throw new Error('Public Chronos-2 service did not return a 1-day forecast.');
  }

  // Compute daily target log-return drift anchored to Chronos-2 predicted prices at [1, 5, 21, 63, 252]
  const stepDrifts = new Array<number>(252).fill(0);
  const anchorSteps = [1, 5, 21, 63, 252];
  let prevStep = 0;
  let prevCumLogPct = 0;
  for (const step of anchorSteps) {
    const pred = predMap.get(step);
    const cumLogPct = pred ? Math.log(pred.price / basePrice) * 100 : prevCumLogPct;
    const span = step - prevStep;
    // Shrink long-horizon drift conservatively (>63D) to avoid over-extrapolating short-term trend
    const rawDaily = span > 0 ? (cumLogPct - prevCumLogPct) / span : 0;
    const dampedDaily =
      step > 63
        ? Math.max(-0.08, Math.min(0.08, rawDaily * 0.35))
        : Math.max(-2.5, Math.min(2.5, rawDaily));
    for (let s = prevStep; s < step; s++) {
      stepDrifts[s] = dampedDaily;
    }
    prevStep = step;
    prevCumLogPct = cumLogPct;
  }

  // Build 10,000 correlated scenario paths via 5-session moving-block bootstrap of standardized historical innovations
  const allReturnsPct = logReturnsPct(targetBars).slice(-1260);
  const { residuals, recentSigma } = buildStandardizedResiduals(allReturnsPct);
  const nPaths = 10_000;
  const blockLen = 5;
  const seed =
    (symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) +
      Number(etNow.dateEt.replace(/-/g, ''))) >>>
    0;
  const rand = seededRng(seed);

  const horizonOutcomes: Record<HorizonKey, number[]> = {
    tomorrow: new Array<number>(nPaths),
    next_week: new Array<number>(nPaths),
    next_month: new Array<number>(nPaths),
    next_quarter: new Array<number>(nPaths),
    next_year: new Array<number>(nPaths),
  };

  for (let p = 0; p < nPaths; p++) {
    let cumLogPct = 0;
    let step = 0;
    while (step < 252) {
      const startIdx = Math.floor(rand() * residuals.length);
      for (let b = 0; b < blockLen && step < 252; b++) {
        const z = residuals[(startIdx + b) % residuals.length];
        const dailyLogPct = Math.max(-65, Math.min(65, stepDrifts[step] + z * recentSigma));
        cumLogPct += dailyLogPct;
        const simplePct = (Math.exp(Math.max(-20, Math.min(20, cumLogPct / 100))) - 1) * 100;
        const dayNum = step + 1;
        if (dayNum === 1) horizonOutcomes.tomorrow[p] = simplePct;
        else if (dayNum === 5) horizonOutcomes.next_week[p] = simplePct;
        else if (dayNum === 21) horizonOutcomes.next_month[p] = simplePct;
        else if (dayNum === 63) horizonOutcomes.next_quarter[p] = simplePct;
        else if (dayNum === 252) horizonOutcomes.next_year[p] = simplePct;
        step++;
      }
    }
  }

  const distributions = {} as Record<HorizonKey, HorizonForecast>;
  for (const spec of HORIZON_SPECS) {
    const binWidth = getBinWidthForSymbol(
      spec.base_bin_width_pct,
      profile.leverage,
      params.calibrationMode
    );
    distributions[spec.key] = buildDistributionForOutcomes(
      horizonOutcomes[spec.key],
      spec,
      binWidth
    );
  }

  // Construct snapshot & execution signals
  const [premarket, marketInputs] = await Promise.all([
    fetchPremarketTape(symbol, etNow, basePrice),
    gatherPremarketMarketInputs(profile, etNow, lastBar.date, histories),
  ]);
  const completedAux = (ticker: string): DailyBar[] | null => {
    const b = histories.get(ticker);
    if (!b) return null;
    const c = lastCompleteBars(b, etNow);
    return c.length > 0 ? c : null;
  };

  const vixBars = completedAux('^VIX');
  const vxnBars = completedAux('^VXN');
  const futBars = completedAux(profile.futures);
  const tnxBars = completedAux('^TNX');
  const dxyBars = completedAux('DX-Y.NYB');
  const clBars = completedAux('CL=F');

  const vixLevel = vixBars ? vixBars[vixBars.length - 1].close : null;
  const vxnLevel = vxnBars ? vxnBars[vxnBars.length - 1].close : null;
  // Underlying-index implied volatility scaled to an approximate symbol-level value
  // for daily leveraged/inverse ETFs. Sourced from the Cboe CSV (Yahoo fallback).
  let impliedLevel =
    marketInputs.primary_volatility_level !== null && ['^VIX', '^VXN', '^RVX'].includes(profile.volatility)
      ? marketInputs.primary_volatility_level * profile.leverage
      : null;
  if (impliedLevel !== null && !Number.isFinite(impliedLevel)) impliedLevel = null;

  const futChange =
    futBars && futBars.length >= 2
      ? (futBars[futBars.length - 1].close / futBars[futBars.length - 2].close - 1) * 100
      : null;

  const fiveDay =
    targetBars.length >= 6
      ? (basePrice / targetBars[targetBars.length - 6].close - 1) * 100
      : null;
  const twentyDay =
    targetBars.length >= 21
      ? (basePrice / targetBars[targetBars.length - 21].close - 1) * 100
      : null;

  const tail20 = allReturnsPct.slice(-20);
  const mean20 = tail20.reduce((a, b) => a + b, 0) / Math.max(1, tail20.length);
  const rv20 =
    tail20.length >= 20
      ? Math.sqrt(
          tail20.reduce((a, b) => a + Math.pow(b - mean20, 2), 0) / (tail20.length - 1)
        ) * Math.sqrt(252)
      : null;

  const rawTnx = tnxBars ? tnxBars[tnxBars.length - 1].close : null;
  const us10y = rawTnx !== null ? (rawTnx > 20 ? rawTnx / 10 : rawTnx) : null;
  const dxyLevel = dxyBars ? dxyBars[dxyBars.length - 1].close : null;
  const wtiUsd = clBars ? clBars[clBars.length - 1].close : null;

  const missingInputs: string[] = [...premarket.missing];
  if (vixLevel === null) missingInputs.push('vix_level');
  if (vxnLevel === null) missingInputs.push('vxn_level');
  missingInputs.push(...marketInputs.missing);
  if (us10y === null) missingInputs.push('us_10y_yield_pct');

  const lastDate = (bars: DailyBar[] | null) => (bars ? bars[bars.length - 1].date : null);
  const inputObservations: InputObservation[] = [
    dailyObservation('prev_close', 'yahoo_chart_1d', symbol, lastBar.date),
    ...premarket.observations,
    ...marketInputs.observations,
  ];
  const yahooDailyInputs: Array<[string, string, DailyBar[] | null, unknown]> = [
    ['vix_level', '^VIX', vixBars, vixLevel],
    ['vxn_level', '^VXN', vxnBars, vxnLevel],
    ['futures_daily_change_pct', profile.futures, futBars, futChange],
    ['us_10y_yield_pct', '^TNX', tnxBars, us10y],
    ['dxy_level', 'DX-Y.NYB', dxyBars, dxyLevel],
    ['wti_crude_usd', 'CL=F', clBars, wtiUsd],
  ];
  for (const [field, ticker, bars, value] of yahooDailyInputs) {
    const date = lastDate(bars);
    if (date && value !== null) inputObservations.push(dailyObservation(field, 'yahoo_chart_1d', ticker, date));
  }
  const symbolIvSource = marketInputs.observations.find((o) => o.field === 'iv_rank_pct');
  if (impliedLevel !== null && symbolIvSource) {
    inputObservations.push({ ...symbolIvSource, field: 'symbol_iv_pct' });
  }
  for (const [t, err] of fetchErrors.entries()) {
    if (t !== symbol) missingInputs.push(`${t}: ${err}`);
  }

  const uniqueMissing = Array.from(new Set(missingInputs));
  const auxSuccessCount = histories.size - 1;
  const confidenceScore = Math.min(1, Number(((auxSuccessCount + 2) / 10).toFixed(2)));
  const sourceCoverage = targetBars.length >= 250 && auxSuccessCount >= 3 ? 'mixed' : 'degraded';

  const snapshot: MarketSnapshot = {
    symbol,
    underlying_symbol: profile.underlying,
    leverage_factor: profile.leverage,
    base_session_date: lastBar.date,
    as_of_utc: nowUtc,
    market_session_phase: getSessionPhase(etNow),
    prev_close: basePrice,
    premarket_open_4am: premarket.premarket_open_4am,
    premarket_30m_high: premarket.premarket_30m_high,
    premarket_30m_low: premarket.premarket_30m_low,
    premarket_30m_change_pct: premarket.premarket_30m_change_pct,
    premarket_30m_volume: premarket.premarket_30m_volume,
    pre_market_or_latest_price: premarket.pre_market_or_latest_price,
    pre_market_change_pct: premarket.pre_market_change_pct,
    intraday_high: lastBar.high,
    intraday_low: lastBar.low,
    five_day_return_pct: fiveDay,
    twenty_day_return_pct: twentyDay,
    overnight_futures_symbol: profile.futures,
    overnight_futures_change_pct: marketInputs.overnight_futures_change_pct,
    futures_daily_change_pct: futChange,
    vix_level: vixLevel,
    vix_overnight_level: marketInputs.vix_overnight_level,
    vxn_level: vxnLevel,
    rvx_level: marketInputs.rvx_level,
    vix9d_level: marketInputs.vix9d_level,
    vix3m_level: marketInputs.vix3m_level,
    symbol_iv_pct: impliedLevel,
    iv_rank_pct: marketInputs.iv_rank_pct,
    put_call_ratio: null,
    realized_vol_20d_pct: rv20,
    us_2y_yield_pct: null,
    us_10y_yield_pct: us10y,
    dxy_level: dxyLevel,
    wti_crude_usd: wtiUsd,
    fed_watch_summary: 'Not supplied by the Yahoo Finance daily-history adapter.',
    key_headlines: [],
    next_day_catalysts: [],
    missing_inputs: uniqueMissing,
    confidence_score: confidenceScore,
    source_coverage: sourceCoverage,
    raw_research_notes: `Connected automatically to public Amazon Chronos-2 service (${publicUrl}). Point forecasts at 1D–252D horizons combined with 10,000 five-session circular block-bootstrap scenarios from ${targetBars.length} completed daily sessions (anchored to ${lastBar.date} close $${basePrice.toFixed(2)}). Overnight futures change, overnight VIX, VIX9D/VIX3M/RVX and IV rank are snapshot and display inputs only; they are not model covariates because no history exists at the same pre-market clock time.${marketInputs.notes.length ? ` ${marketInputs.notes.join(' ')}` : ''}`,
    input_observations: inputObservations,
  };

  // Volatility state & regime classification
  const trailingRv252: number[] = [];
  for (let i = Math.max(20, allReturnsPct.length - 252); i < allReturnsPct.length; i++) {
    const win = allReturnsPct.slice(i - 20, i);
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    const sd = Math.sqrt(win.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (win.length - 1));
    trailingRv252.push(sd * Math.sqrt(252));
  }
  const sortedRv = [...trailingRv252].sort((a, b) => a - b);
  const currentRv = trailingRv252[trailingRv252.length - 1] ?? 0;
  const q50Rv = quantileSorted(sortedRv, 0.5);
  const q85Rv = quantileSorted(sortedRv, 0.85);
  const q97Rv = quantileSorted(sortedRv, 0.97);

  const volatilityState =
    currentRv < q50Rv
      ? 'compressed'
      : currentRv < q85Rv
        ? 'normal'
        : currentRv < q97Rv
          ? 'elevated'
          : 'extreme';

  const mom20 = allReturnsPct.slice(-20).reduce((a, b) => a + b, 0);
  const regime =
    mom20 > 2 && (volatilityState === 'compressed' || volatilityState === 'normal')
      ? 'low_vol_uptrend'
      : mom20 > 2
        ? 'breakout_expansion'
        : mom20 < -2
          ? 'high_vol_downtrend'
          : 'mean_reverting_range';

  const oneDay = distributions.tomorrow.summary;
  const leftTail = Math.abs(oneDay.quantiles_pct.p05 - oneDay.median_pct);
  const rightTail = Math.abs(oneDay.quantiles_pct.p95 - oneDay.median_pct);
  const skewBias =
    leftTail > rightTail * 1.2
      ? 'bearish_tail'
      : rightTail > leftTail * 1.2
        ? 'bullish_tail'
        : 'neutral';

  const gap = premarket.pre_market_change_pct;
  const gapRisk =
    gap === null
      ? 'moderate'
      : Math.abs(gap) >= 2
        ? 'high'
        : Math.abs(gap) >= 0.75
          ? 'moderate'
          : 'low';

  const volSpread = impliedLevel !== null && rv20 !== null ? impliedLevel - rv20 : 0;

  const executionSignals: ExecutionSignals = {
    data_quality: {
      confidence_score: confidenceScore,
      source_coverage: sourceCoverage,
      missing_inputs: uniqueMissing,
    },
    regime,
    volatility_state: volatilityState,
    implied_vs_realized_vol_spread_pct: volSpread,
    expected_1d_move_pct: Math.max(0, (oneDay.quantiles_pct.p95 - oneDay.quantiles_pct.p05) / 2),
    skew_bias: skewBias,
    overnight_gap_risk: gapRisk,
    kelly_fraction_cap: 0,
    next_day_catalysts: [],
    suggested_strategy_weights: {
      momentum_trend: 0,
      mean_reversion: 0,
      volatility_harvesting: 0,
      cash_defensive: 1,
    },
  };

  const sources: GroundingSource[] = [
    {
      title: `Public Amazon Chronos-2 Inference API (${publicUrl})`,
      uri: publicUrl,
      domain: new URL(publicUrl).hostname,
    },
    ...Array.from(histories.keys())
      .sort()
      .map((t) => ({
        title: `Yahoo Finance daily history: ${t}`,
        uri: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}/`,
        domain: 'finance.yahoo.com',
      })),
  ];

  const rawPayload: ForecastPayload = {
    schema_version: FORECAST_SCHEMA_VERSION,
    symbol,
    as_of: nowUtc,
    base_price: Number(basePrice.toFixed(2)),
    return_type: 'simple_pct',
    model: `amazon/chronos-2 (public service ${new URL(publicUrl).hostname}; 5-session block bootstrap; 10,000 scenarios)`,
    execution_signals: executionSignals,
    horizons: distributions,
  };

  params.onProgress?.({
    stage: 'audit',
    message: 'Auditing Chronos-2 scenario probabilities, CDF monotonicity, moments, and quantiles...',
    snapshot,
    sources,
  });

  const { payload, audit } = auditAndReconcileForecast(
    rawPayload,
    profile.leverage,
    params.calibrationMode
  );

  const record: ForecastRecord = {
    id: crypto.randomUUID(),
    created_at: nowUtc,
    trigger: params.trigger,
    calibration_mode: params.calibrationMode,
    run_window: params.runWindow,
    payload,
    snapshot,
    sources,
    audit,
  };

  params.onProgress?.({
    stage: 'complete',
    message: 'Public Chronos-2 forecast and deterministic probability audit completed.',
    snapshot,
    sources,
  });

  return record;
}

export async function verifyPublicRealizedOutcome(
  record: ForecastRecord
): Promise<RealizedVerification> {
  const baseDate = record.snapshot.base_session_date ?? record.payload.as_of.slice(0, 10);
  const symbol = record.payload.symbol;
  const etNow = getEasternNow();

  HISTORY_CACHE.delete(symbol);
  const allBars = await fetchYahooDailyBars(symbol);
  const completed = lastCompleteBars(allBars, etNow).filter((b) => b.date > baseDate);

  if (completed.length === 0 || record.payload.base_price <= 0) {
    throw new Error(
      `No completed post-forecast regular-session close for ${symbol} after ${baseDate} is available yet.`
    );
  }

  const nextSession = completed[0];
  const actualReturnPct = Number(
    (((nextSession.close - record.payload.base_price) / record.payload.base_price) * 100).toFixed(2)
  );
  const probPos = record.payload.horizons.tomorrow.summary.prob_positive;
  const outcomePos = actualReturnPct > 0 ? 1 : 0;
  const brierScore = Number(Math.pow(probPos - outcomePos, 2).toFixed(4));
  const q = record.payload.horizons.tomorrow.summary.quantiles_pct;

  return {
    verified_at: new Date().toISOString(),
    target_horizon: 'tomorrow',
    actual_close_price: Number(nextSession.close.toFixed(2)),
    actual_return_pct: actualReturnPct,
    brier_score: brierScore,
    within_iqr_p25_p75: actualReturnPct >= q.p25 && actualReturnPct <= q.p75,
    within_90_p05_p95: actualReturnPct >= q.p05 && actualReturnPct <= q.p95,
    notes: `Verified against ${nextSession.date} adjusted regular-session close ($${nextSession.close.toFixed(2)}) via Yahoo Finance.`,
    sources: [
      {
        title: `Yahoo Finance adjusted close: ${symbol}`,
        uri: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`,
        domain: 'finance.yahoo.com',
      },
    ],
  };
}
