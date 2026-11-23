import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import crypto from 'crypto';
import type {
  CalibrationMode,
  ForecastPayload,
  ForecastRecord,
  GroundingSource,
  MarketSnapshot,
  RealizedVerification,
  RunWindow,
} from '../src/types/forecast.ts';
import {
  auditAndReconcileForecast,
  buildExpectedBins,
  getBinWidthForSymbol,
  HORIZON_SPECS,
} from './mathAudit.ts';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGeminiErrorText(err: unknown): string {
  if (err instanceof Error) {
    const detail = err as Error & { error?: unknown; response?: unknown };
    const nested = [detail.error, detail.response]
      .filter(Boolean)
      .map((value) => {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      });
    return [err.message, ...nested].join('\n');
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function isQuotaError(err: unknown): boolean {
  return /429|RESOURCE_EXHAUSTED|quota/i.test(getGeminiErrorText(err));
}

function getSuggestedRetryDelayMs(message: string, attempt: number): number {
  const match =
    message.match(/retry in\\s+(\\d+(?:\\.\\d+)?)s/i) ??
    message.match(/retryDelay["']?\\s*[:=]\\s*["']?(\\d+(?:\\.\\d+)?)s/i) ??
    message.match(/retry-after["']?\\s*[:=]\\s*["']?(\\d+)/i);
  if (match) return Math.max(1000, Math.ceil(Number(match[1]) * 1000));
  return attempt === 0 ? 2500 : 6000;
}

function formatGeminiError(err: unknown): Error {
  const raw = getGeminiErrorText(err);
  if (isQuotaError(err)) {
    return new Error(
      `Gemini API quota/rate limit reached. The API response was: ${raw.slice(0, 1200)}. Check the selected project's model and Search grounding limits at https://ai.dev/rate-limit. Google Search grounding requires a billing-enabled Gemini API project.`
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = getGeminiErrorText(err);
      const isServerOverload =
        message.includes('503') || message.includes('UNAVAILABLE');
      // A 429 is retried only when Google explicitly supplies a retry hint.
      // A zero/unavailable quota (including free-tier Search grounding) will not
      // recover by repeating the same request.
      const hasRetryHint = /retry in\\s+\\d|retryDelay|retry-after/i.test(message);
      const isRetryable = isServerOverload || (isQuotaError(err) && hasRetryHint);

      if (!isRetryable || attempt === maxRetries) {
        throw formatGeminiError(err);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, getSuggestedRetryDelayMs(message, attempt))
      );
    }
  }
  throw formatGeminiError(lastError);
}

function getSymbolProfile(rawSymbol: string): {
  symbol: string;
  underlying: string;
  leverage: number;
  volIndex: string;
  futuresProxy: string;
} {
  const symbol = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '') || 'TQQQ';
  const leveragedMap: Record<
    string,
    { underlying: string; leverage: number; volIndex: string; futuresProxy: string }
  > = {
    TQQQ: { underlying: 'QQQ', leverage: 3, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    SQQQ: { underlying: 'QQQ', leverage: 3, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    QLD: { underlying: 'QQQ', leverage: 2, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    QID: { underlying: 'QQQ', leverage: 2, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    QQQ: { underlying: 'QQQ', leverage: 1, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    UPRO: { underlying: 'SPY', leverage: 3, volIndex: 'VIX', futuresProxy: 'ES=F' },
    SPXU: { underlying: 'SPY', leverage: 3, volIndex: 'VIX', futuresProxy: 'ES=F' },
    SSO: { underlying: 'SPY', leverage: 2, volIndex: 'VIX', futuresProxy: 'ES=F' },
    SPY: { underlying: 'SPY', leverage: 1, volIndex: 'VIX', futuresProxy: 'ES=F' },
    SOXL: { underlying: 'SOXX', leverage: 3, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    SOXS: { underlying: 'SOXX', leverage: 3, volIndex: 'VXN', futuresProxy: 'NQ=F' },
    TNA: { underlying: 'IWM', leverage: 3, volIndex: 'RVX', futuresProxy: 'RTY=F' },
  };

  const match = leveragedMap[symbol];
  if (match) {
    return { symbol, ...match };
  }
  return {
    symbol,
    underlying: symbol,
    leverage: 1,
    volIndex: 'VIX',
    futuresProxy: 'ES=F',
  };
}

function extractGroundingSources(response: unknown): GroundingSource[] {
  const res = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };
  const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of chunks) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    let domain = 'web';
    try {
      domain = new URL(uri).hostname.replace(/^www\./, '');
    } catch {
      domain = 'web';
    }
    sources.push({
      title: chunk.web?.title?.trim() || domain,
      uri,
      domain,
    });
  }
  return sources;
}

function parseJsonLoose<T>(text: string | undefined): T {
  if (!text) {
    throw new Error('Model returned empty response.');
  }
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Failed to parse JSON output from model.');
  }
}

export interface ProgressEvent {
  stage: 'retrieval' | 'synthesis' | 'audit' | 'complete';
  message: string;
  snapshot?: MarketSnapshot;
  sources?: GroundingSource[];
}

const RESEARCH_MODEL =
  process.env.GEMINI_RESEARCH_MODEL ?? 'gemini-3.8-flash';

const FORECAST_MODEL =
  process.env.GEMINI_FORECAST_MODEL ?? 'gemini-4-hydrogen';

const VERIFY_MODEL =
  process.env.GEMINI_VERIFY_MODEL ?? 'gemini-3.8-flash';

const GOOGLE_SEARCH_ENABLED =
  process.env.GEMINI_ENABLE_GOOGLE_SEARCH?.trim().toLowerCase() === 'true';

function createUnavailableMarketSnapshot(
  profile: ReturnType<typeof getSymbolProfile>,
  asOfUtc: string,
  reason: string
): MarketSnapshot {
  const missingInputs = [
    'prev_close',
    'premarket_open_4am',
    'premarket_30m_high',
    'premarket_30m_low',
    'premarket_30m_change_pct',
    'premarket_30m_volume',
    'pre_market_or_latest_price',
    'pre_market_change_pct',
    'intraday_high',
    'intraday_low',
    'five_day_return_pct',
    'twenty_day_return_pct',
    'overnight_futures_change_pct',
    'vix_level',
    'vxn_level',
    'vix9d_level',
    'vix3m_level',
    'symbol_iv_pct',
    'iv_rank_pct',
    'put_call_ratio',
    'realized_vol_20d_pct',
    'us_2y_yield_pct',
    'us_10y_yield_pct',
    'dxy_level',
    'wti_crude_usd',
    'fed_watch_summary',
    'key_headlines',
    'next_day_catalysts',
  ];

  return {
    symbol: profile.symbol,
    underlying_symbol: profile.underlying,
    leverage_factor: profile.leverage,
    as_of_utc: asOfUtc,
    market_session_phase: 'unavailable',
    prev_close: null,
    premarket_open_4am: null,
    premarket_30m_high: null,
    premarket_30m_low: null,
    premarket_30m_change_pct: null,
    premarket_30m_volume: null,
    pre_market_or_latest_price: null,
    pre_market_change_pct: null,
    intraday_high: null,
    intraday_low: null,
    five_day_return_pct: null,
    twenty_day_return_pct: null,
    overnight_futures_symbol: profile.futuresProxy,
    overnight_futures_change_pct: null,
    vix_level: null,
    vxn_level: null,
    vix9d_level: null,
    vix3m_level: null,
    symbol_iv_pct: null,
    iv_rank_pct: null,
    put_call_ratio: null,
    realized_vol_20d_pct: null,
    us_2y_yield_pct: null,
    us_10y_yield_pct: null,
    dxy_level: null,
    wti_crude_usd: null,
    fed_watch_summary: 'Unavailable: no live market research was retrieved.',
    key_headlines: [],
    next_day_catalysts: [],
    missing_inputs: missingInputs,
    confidence_score: 0,
    source_coverage: 'degraded',
    raw_research_notes: `LIVE RESEARCH UNAVAILABLE. ${reason} No current market, volatility, futures, macro, or news values are supplied to the forecast synthesis. Treat any resulting distribution as illustrative only; no trading allocation is permitted.`,
  };
}

export async function runForecastPipeline(params: {
  symbol: string;
  calibrationMode: CalibrationMode;
  runWindow: RunWindow;
  trigger: 'manual' | 'scheduled';
  onProgress?: (event: ProgressEvent) => void;
}): Promise<ForecastRecord> {
  const ai = getClient();
  const profile = getSymbolProfile(params.symbol);
  const nowUtc = new Date().toISOString();
  const nowEt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date());

  params.onProgress?.({
    stage: 'retrieval',
    message: GOOGLE_SEARCH_ENABLED
      ? `Querying live multi-source market, ${profile.volIndex}/VIX, ${profile.futuresProxy} futures, and macro feeds for ${profile.symbol}...`
      : 'Live Google Search grounding is disabled. Skipping retrieval rather than inventing current market data...',
  });

  const windowContext =
    params.runWindow === 'pre_market'
      ? `PRE-MARKET 04:30 ET REST-OF-DAY WINDOW: Evaluate the first 30 minutes of US pre-market trading (04:00–04:30 AM ET) plus all overnight/global market data available at 04:30 AM ET so the forecast is ready before the 05:00 AM ET trading start.`
      : params.runWindow === 'pre_bell'
        ? `PRE-BELL 08:30 ET WINDOW: Incorporate full 04:00–08:30 AM ET pre-market tape plus 08:30 AM ET macro releases prior to the 09:30 AM ET regular cash open.`
        : `EOD CLOSE WINDOW: Evaluate full regular session close and initial after-hours action.`;

  const researchPrompt = `
You are executing STEP 1 (Active Multi-Source Web Retrieval & Verification) of an institutional quantitative market forecast pipeline.

Current System Timestamp (UTC): ${nowUtc}
Current US Eastern Time: ${nowEt}
Execution Window Mode: ${params.runWindow}
Window Context: ${windowContext}
Target Symbol: ${profile.symbol}
Underlying Index/ETF Proxy: ${profile.underlying} (Leverage factor: ${profile.leverage}x)
Primary Volatility Index: ${profile.volIndex}
Overnight Futures Proxy: ${profile.futuresProxy}

Perform targeted web searches across authoritative financial domains (Yahoo Finance, Nasdaq, MarketWatch, Cboe, CME Group / FedWatch, US Treasury, Barchart, Investing.com, BLS/BEA/Federal Reserve) to retrieve the freshest verified market state as of ${nowEt}:

1. Price, Early Pre-Market (04:00–04:30 ET) & Session Action for ${profile.symbol} (and ${profile.underlying} if leveraged):
   - Most recent official regular closing price (prev_close).
   - Early Pre-Market Opening 30-Minute Window (04:00–04:30 AM ET): 04:00 AM ET pre-market open price (premarket_open_4am), 04:00–04:30 ET high (premarket_30m_high), 04:00–04:30 ET low (premarket_30m_low), % move across that 30-minute window (premarket_30m_change_pct), and early pre-market share volume (premarket_30m_volume).
   - Latest active pre-market/extended quote as of ~04:30+ ET (pre_market_or_latest_price) and total % change vs. prev_close (pre_market_change_pct).
   - Prior regular session intraday high & low, and approximate 5-day and 20-day % returns.
   - Overnight index futures (${profile.futuresProxy}) % move and whether the 04:00–04:30 ET tape confirmed or faded the overnight futures gap.
2. Volatility & Options Positioning:
   - Current Cboe VIX, Cboe ${profile.volIndex} (if applicable), VIX9D, VIX3M term structure.
   - ${profile.symbol} / ${profile.underlying} 30-day Implied Volatility (IV %), IV Rank (%), put/call ratio, and 20-day realized volatility (%).
3. Macro, Rates & Cross-Asset Context:
   - Current US 2-Year and 10-Year Treasury yields (%) including overnight European/London session yield shifts.
   - US Dollar Index (DXY) and WTI Crude Oil (USD).
   - Current CME FedWatch implied rate path expectations.
4. Scheduled Catalysts & Breaking Headlines for Rest of Day & Next 5D:
   - Remaining today (05:00–16:00 ET / 20:00 ET) and next 5D scheduled economic releases (08:30 ET CPI/PCE/PPI/NFP/Claims, 10:00 ET ISM/JOLTS, 14:00 ET FOMC, Treasury auctions) and major ${profile.underlying} constituent earnings (NVDA, AAPL, MSFT, AMZN, META, GOOGL, AVGO, TSLA).
   - 3–5 concise market-moving headlines affecting ${profile.symbol} right now.

CRITICAL: Do NOT fabricate any figure. If a metric (such as granular 04:00–04:30 ET high/low/volume before the session or if data is not publicly reported) cannot be reliably retrieved from live search results, set it to null and add its exact field name to "missing_inputs".

Return ONLY a valid JSON object matching this exact structure (no markdown fences):
{
  "symbol": "${profile.symbol}",
  "underlying_symbol": "${profile.underlying}",
  "leverage_factor": ${profile.leverage},
  "as_of_utc": "${nowUtc}",
  "market_session_phase": "pre_market | regular_open | after_hours | closed",
  "prev_close": number | null,
  "premarket_open_4am": number | null,
  "premarket_30m_high": number | null,
  "premarket_30m_low": number | null,
  "premarket_30m_change_pct": number | null,
  "premarket_30m_volume": number | null,
  "pre_market_or_latest_price": number | null,
  "pre_market_change_pct": number | null,
  "intraday_high": number | null,
  "intraday_low": number | null,
  "five_day_return_pct": number | null,
  "twenty_day_return_pct": number | null,
  "overnight_futures_symbol": "${profile.futuresProxy}",
  "overnight_futures_change_pct": number | null,
  "vix_level": number | null,
  "vxn_level": number | null,
  "vix9d_level": number | null,
  "vix3m_level": number | null,
  "symbol_iv_pct": number | null,
  "iv_rank_pct": number | null,
  "put_call_ratio": number | null,
  "realized_vol_20d_pct": number | null,
  "us_2y_yield_pct": number | null,
  "us_10y_yield_pct": number | null,
  "dxy_level": number | null,
  "wti_crude_usd": number | null,
  "fed_watch_summary": "string",
  "key_headlines": ["string"],
  "next_day_catalysts": [
    { "time_utc": "HH:MM", "event": "string", "impact": "low | medium | high" }
  ],
  "missing_inputs": ["string"],
  "confidence_score": number (0.00 to 1.00),
  "source_coverage": "primary_verified | mixed | degraded",
  "raw_research_notes": "2-3 sentence summary covering the 04:00-04:30 ET opening impulse, cross-source reconciliation, and rest-of-day posture."
}
`;
  let sources: GroundingSource[] = [];
  let snapshot: MarketSnapshot;
  let hasLiveResearch = false;

  if (GOOGLE_SEARCH_ENABLED) {
    try {
      const pass1Response = await withRetry(() =>
        ai.models.generateContent({
          model: RESEARCH_MODEL,
          contents: researchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            seed: 42,
          },
        })
      );

      const groundedSources = extractGroundingSources(pass1Response);
      if (groundedSources.length > 0) {
        sources = groundedSources;
        snapshot = parseJsonLoose<MarketSnapshot>(pass1Response.text);
        hasLiveResearch = true;
      } else {
        snapshot = createUnavailableMarketSnapshot(
          profile,
          nowUtc,
          'Google Search was enabled, but the research response contained no grounding citations.'
        );
      }
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      snapshot = createUnavailableMarketSnapshot(
        profile,
        nowUtc,
        `Google Search grounding was rejected by the API quota: ${getGeminiErrorText(err).slice(0, 400)}`
      );
    }
  } else {
    snapshot = createUnavailableMarketSnapshot(
      profile,
      nowUtc,
      'GEMINI_ENABLE_GOOGLE_SEARCH is not true. Google Search grounding is unavailable on the Gemini API Free Tier.'
    );
  }

  // Normalize snapshot defaults
  snapshot.symbol = profile.symbol;
  snapshot.underlying_symbol = profile.underlying;
  snapshot.leverage_factor = profile.leverage;
  snapshot.as_of_utc = nowUtc;
  snapshot.premarket_open_4am = snapshot.premarket_open_4am ?? null;
  snapshot.premarket_30m_high = snapshot.premarket_30m_high ?? null;
  snapshot.premarket_30m_low = snapshot.premarket_30m_low ?? null;
  snapshot.premarket_30m_change_pct = snapshot.premarket_30m_change_pct ?? null;
  snapshot.premarket_30m_volume = snapshot.premarket_30m_volume ?? null;
  snapshot.missing_inputs = Array.isArray(snapshot.missing_inputs) ? snapshot.missing_inputs : [];
  snapshot.next_day_catalysts = Array.isArray(snapshot.next_day_catalysts)
    ? snapshot.next_day_catalysts
    : [];
  snapshot.key_headlines = Array.isArray(snapshot.key_headlines) ? snapshot.key_headlines : [];

  if (sources.length === 0 && snapshot.source_coverage === 'primary_verified') {
    snapshot.source_coverage = 'mixed';
  }

  params.onProgress?.({
    stage: 'synthesis',
    message: hasLiveResearch
      ? `Retrieved ${sources.length} grounded sources. Synthesizing regime classification & rest-of-day distributions...`
      : 'No verified live market data is available. Generating a degraded report with zero Kelly allocation...',
    snapshot,
    sources,
  });

  const basePrice =
    snapshot.pre_market_or_latest_price ??
    snapshot.prev_close ??
    0;

  // Build explicit bin specifications for the synthesis prompt
  const horizonPromptSpecs = HORIZON_SPECS.map((spec) => {
    const width = getBinWidthForSymbol(
      spec.base_bin_width_pct,
      profile.leverage,
      params.calibrationMode
    );
    const bins = buildExpectedBins(width);
    return {
      key: spec.key,
      label: spec.label,
      trading_days: spec.trading_days,
      bin_width_pct: width,
      bins,
    };
  });

  const synthesisPrompt = `
You are executing STEPS 2–4 (Quantitative Feature Extraction, Regime Classification, Multi-Horizon Probability Distribution Synthesis, and Strategy Allocation) of an institutional quantitative market-regime engine.

VERIFIED STEP 1 MARKET SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

CALIBRATION PARAMETERS:
- Target Symbol: ${profile.symbol} (Underlying: ${profile.underlying}, Leverage: ${profile.leverage}x)
- Base Reference Price (04:30 ET Pre-Market / Latest): ${basePrice}
- Calibration Mode: ${params.calibrationMode}
- Run Window: ${params.runWindow}
${
  params.runWindow === 'pre_market'
    ? `- REST-OF-DAY PRE-MARKET CONDITIONING (04:30 ET -> Regular Close, prior to 05:00 ET trade entry): Condition the "tomorrow" (1D) return distribution on the observed 04:00–04:30 AM ET pre-market opening tape (premarket_30m_change_pct, volume, high/low structure), gap-fill vs. trend-continuation odds relative to prev_close and overnight ${profile.futuresProxy}, and remaining 08:30 ET / intraday catalysts.`
    : ''
}
${
  profile.leverage > 1
    ? `- IMPORTANT LEVERAGED ETF MODELING RULE: ${profile.symbol} is a ${profile.leverage}x daily leveraged ETF tracking ${profile.underlying}. Model the underlying ${profile.underlying} return distribution using ${profile.volIndex}/VIX and overnight ${profile.futuresProxy} first, scale 1D moves by ${profile.leverage}x, and for multi-day horizons (21D, 63D, 252D) explicitly incorporate daily compounding volatility drag (-0.5 * L * (L - 1) * sigma^2 * t) and negative convexity in high-volatility regimes.`
    : ''
}
- Uncertainty Penalty Rule: If confidence_score < 0.75 or key volatility metrics are in missing_inputs, widen dispersion and assign higher tail mass to underflow_prob / overflow_prob.

EXACT BIN GEOMETRY REQUIRED FOR EACH HORIZON:
${horizonPromptSpecs
  .map(
    (h) =>
      `- ${h.key} ("${h.label}", ${h.trading_days}D, bin_width_pct=${h.bin_width_pct}): bins = ${h.bins
        .map((b) => `[${b.min_pct}, ${b.max_pct}]`)
        .join(', ')}`
  )
  .join('\n')}

MATHEMATICAL CONSTRAINTS:
1. For each horizon, produce exactly 10 bins matching the exact min_pct and max_pct ranges above.
2. underflow_prob + sum(bins[].prob) + overflow_prob MUST equal 1.0000.
3. bins[i].cdf MUST be monotonically cumulative starting from underflow_prob + bins[0].prob and ending at 1.0000 - overflow_prob.
4. suggested_strategy_weights MUST sum strictly to 1.00.
5. kelly_fraction_cap must be in [0.00, 1.00], scaled downward when overnight_gap_risk is high, volatility_state is elevated/extreme, or confidence_score is degraded.
`;

  const binSchema = {
    type: Type.OBJECT,
    properties: {
      min_pct: { type: Type.NUMBER },
      max_pct: { type: Type.NUMBER },
      prob: { type: Type.NUMBER },
      cdf: { type: Type.NUMBER },
    },
    required: ['min_pct', 'max_pct', 'prob', 'cdf'],
  };

  const horizonSchema = {
    type: Type.OBJECT,
    properties: {
      label: { type: Type.STRING },
      trading_days: { type: Type.INTEGER },
      bin_width_pct: { type: Type.NUMBER },
      underflow_prob: { type: Type.NUMBER },
      overflow_prob: { type: Type.NUMBER },
      bins: { type: Type.ARRAY, items: binSchema },
      summary: {
        type: Type.OBJECT,
        properties: {
          mean_pct: { type: Type.NUMBER },
          median_pct: { type: Type.NUMBER },
          std_pct: { type: Type.NUMBER },
          prob_positive: { type: Type.NUMBER },
          expected_shortfall_5pct: { type: Type.NUMBER },
          quantiles_pct: {
            type: Type.OBJECT,
            properties: {
              p01: { type: Type.NUMBER },
              p05: { type: Type.NUMBER },
              p25: { type: Type.NUMBER },
              p75: { type: Type.NUMBER },
              p95: { type: Type.NUMBER },
              p99: { type: Type.NUMBER },
            },
            required: ['p01', 'p05', 'p25', 'p75', 'p95', 'p99'],
          },
        },
        required: [
          'mean_pct',
          'median_pct',
          'std_pct',
          'prob_positive',
          'expected_shortfall_5pct',
          'quantiles_pct',
        ],
      },
    },
    required: [
      'label',
      'trading_days',
      'bin_width_pct',
      'underflow_prob',
      'overflow_prob',
      'bins',
      'summary',
    ],
  };

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      schema_version: { type: Type.STRING },
      symbol: { type: Type.STRING },
      as_of: { type: Type.STRING },
      base_price: { type: Type.NUMBER },
      return_type: { type: Type.STRING },
      model: { type: Type.STRING },
      execution_signals: {
        type: Type.OBJECT,
        properties: {
          data_quality: {
            type: Type.OBJECT,
            properties: {
              confidence_score: { type: Type.NUMBER },
              source_coverage: { type: Type.STRING },
              missing_inputs: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['confidence_score', 'source_coverage', 'missing_inputs'],
          },
          regime: { type: Type.STRING },
          volatility_state: { type: Type.STRING },
          implied_vs_realized_vol_spread_pct: { type: Type.NUMBER },
          expected_1d_move_pct: { type: Type.NUMBER },
          skew_bias: { type: Type.STRING },
          overnight_gap_risk: { type: Type.STRING },
          kelly_fraction_cap: { type: Type.NUMBER },
          next_day_catalysts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                time_utc: { type: Type.STRING },
                event: { type: Type.STRING },
                impact: { type: Type.STRING },
              },
              required: ['time_utc', 'event', 'impact'],
            },
          },
          suggested_strategy_weights: {
            type: Type.OBJECT,
            properties: {
              momentum_trend: { type: Type.NUMBER },
              mean_reversion: { type: Type.NUMBER },
              volatility_harvesting: { type: Type.NUMBER },
              cash_defensive: { type: Type.NUMBER },
            },
            required: [
              'momentum_trend',
              'mean_reversion',
              'volatility_harvesting',
              'cash_defensive',
            ],
          },
        },
        required: [
          'data_quality',
          'regime',
          'volatility_state',
          'implied_vs_realized_vol_spread_pct',
          'expected_1d_move_pct',
          'skew_bias',
          'overnight_gap_risk',
          'kelly_fraction_cap',
          'next_day_catalysts',
          'suggested_strategy_weights',
        ],
      },
      horizons: {
        type: Type.OBJECT,
        properties: {
          tomorrow: horizonSchema,
          next_week: horizonSchema,
          next_month: horizonSchema,
          next_quarter: horizonSchema,
          next_year: horizonSchema,
        },
        required: ['tomorrow', 'next_week', 'next_month', 'next_quarter', 'next_year'],
      },
    },
    required: [
      'schema_version',
      'symbol',
      'as_of',
      'base_price',
      'return_type',
      'model',
      'execution_signals',
      'horizons',
    ],
  };

  const pass2Response = await withRetry(() =>
    ai.models.generateContent({
      model: FORECAST_MODEL,
      contents: synthesisPrompt,
      config: {
        systemInstruction:
          'You are an institutional quantitative forecasting engine. Output strictly calibrated numerical probabilities matching the exact bin boundaries and schema.',
        responseMimeType: 'application/json',
        responseSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        seed: 42,
      },
    })
  );

  const rawPayload = parseJsonLoose<ForecastPayload>(pass2Response.text);
  rawPayload.symbol = profile.symbol;
  rawPayload.as_of = nowUtc;
  if (!rawPayload.base_price || rawPayload.base_price <= 0) {
    rawPayload.base_price = basePrice;
  }
  if (!hasLiveResearch) {
    rawPayload.base_price = 0;
    rawPayload.execution_signals.data_quality = {
      confidence_score: 0,
      source_coverage: 'degraded',
      missing_inputs: snapshot.missing_inputs,
    };
    rawPayload.execution_signals.kelly_fraction_cap = 0;
    rawPayload.execution_signals.suggested_strategy_weights = {
      momentum_trend: 0,
      mean_reversion: 0,
      volatility_harvesting: 0,
      cash_defensive: 1,
    };
  }
  rawPayload.model =
    params.runWindow === 'eod'
      ? 'eod_regime_conditioned_forecast'
      : 'premarket_regime_conditioned_forecast';

  params.onProgress?.({
    stage: 'audit',
    message: 'Running Step 5 deterministic mathematical audit (probability sum, CDF monotonicity, moments, Kelly cap)...',
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
    message: 'Forecast audited and persisted.',
  });

  return record;
}

export async function verifyRealizedOutcome(
  record: ForecastRecord
): Promise<RealizedVerification> {
  const ai = getClient();
  const baseDate = record.payload.as_of.slice(0, 10);
  const symbol = record.payload.symbol;
  const basePrice = record.payload.base_price;

  const verifyPrompt = `
Verify the actual realized market closing price for ${symbol} on the first regular US trading session on or after ${baseDate} (the forecast "as_of" timestamp was ${record.payload.as_of}, with base_price ${basePrice}).
Use live web search (Yahoo Finance, Nasdaq, MarketWatch) to find the official regular-session closing price for that target day.
If the trading session has not yet closed or data is unavailable, return found: false.

Return ONLY valid JSON:
{
  "found": boolean,
  "session_date": "YYYY-MM-DD",
  "actual_close_price": number | null,
  "notes": "1-2 sentence verification summary."
}
`;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: VERIFY_MODEL,
      contents: verifyPrompt,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
  );

  const sources = extractGroundingSources(response);
  const parsed = parseJsonLoose<{
    found: boolean;
    session_date?: string;
    actual_close_price: number | null;
    notes: string;
  }>(response.text);

  if (!parsed.found || !parsed.actual_close_price || basePrice <= 0) {
    throw new Error(
      parsed.notes || `Realized regular-session close for ${symbol} after ${baseDate} is not yet available.`
    );
  }

  const actualReturnPct = Number(
    (((parsed.actual_close_price - basePrice) / basePrice) * 100).toFixed(2)
  );
  const tomorrow = record.payload.horizons.tomorrow;
  const probPos = tomorrow.summary.prob_positive;
  const outcomePositive = actualReturnPct > 0 ? 1 : 0;
  const brierScore = Number(Math.pow(probPos - outcomePositive, 2).toFixed(4));

  const q = tomorrow.summary.quantiles_pct;
  const withinIqr = actualReturnPct >= q.p25 && actualReturnPct <= q.p75;
  const within90 = actualReturnPct >= q.p05 && actualReturnPct <= q.p95;

  return {
    verified_at: new Date().toISOString(),
    target_horizon: 'tomorrow',
    actual_close_price: Number(parsed.actual_close_price.toFixed(2)),
    actual_return_pct: actualReturnPct,
    brier_score: brierScore,
    within_iqr_p25_p75: withinIqr,
    within_90_p05_p95: within90,
    notes: parsed.notes,
    sources,
  };
}
