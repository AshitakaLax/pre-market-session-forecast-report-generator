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
  getBinWidthForSymbol,
  HORIZON_SPECS,
  buildExpectedBins,
} from './mathAudit.ts';

const CHRONOS_SERVICE_URL = (
  process.env.CHRONOS_SERVICE_URL ?? 'http://127.0.0.1:8001'
).replace(/\/+$/, '');

function serviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = process.env.CHRONOS_API_TOKEN;
  if (token) headers.Authorization = \`Bearer \${token}\`;
  return headers;
}

async function callChronosService<T>(
  endpoint: string,
  body: unknown,
  operation: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(\`\${CHRONOS_SERVICE_URL}\${endpoint}\`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      \`Chronos-2 service is unavailable at \${CHRONOS_SERVICE_URL}. Start the Python service or configure CHRONOS_SERVICE_URL. \${operation}: \${detail}\`
    );
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { detail: text.slice(0, 1000) };
  }

  if (!response.ok) {
    const detail =
      typeof parsed === 'object' && parsed !== null && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(\`Chronos-2 \${operation} failed (HTTP \${response.status}): \${detail}\`);
  }

  return parsed as T;
}

export interface ProgressEvent {
  stage: 'retrieval' | 'synthesis' | 'audit' | 'complete';
  message: string;
  snapshot?: MarketSnapshot;
  sources?: GroundingSource[];
}

interface ChronosForecastResponse {
  snapshot: MarketSnapshot;
  sources: GroundingSource[];
  raw_payload: ForecastPayload;
  diagnostics?: {
    model_id: string;
    device: string;
    history_observations: number;
    covariates_used: string[];
    simulation_paths: number;
    block_length: number;
    forecast_steps: number;
    last_completed_session: string;
    anchor_price_type: string;
    calibration_status: string;
  };
}

interface ChronosVerifyResponse {
  found: boolean;
  session_date: string | null;
  actual_close_price: number | null;
  notes: string;
}

export async function runForecastPipeline(params: {
  symbol: string;
  calibrationMode: CalibrationMode;
  runWindow: RunWindow;
  trigger: 'manual' | 'scheduled';
  onProgress?: (event: ProgressEvent) => void;
}): Promise<ForecastRecord> {
  const symbol = params.symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '') || 'TQQQ';
  const nowUtc = new Date().toISOString();
  const horizonSpecs = HORIZON_SPECS.map((spec) => {
    const width = getBinWidthForSymbol(
      spec.base_bin_width_pct,
      getLeverageFactor(symbol),
      params.calibrationMode
    );
    return {
      key: spec.key,
      label: spec.label,
      trading_days: spec.trading_days,
      bin_width_pct: width,
      bins: buildExpectedBins(width),
    };
  });

  params.onProgress?.({
    stage: 'retrieval',
    message: \`Loading completed daily market history and covariates for \${symbol}...\`,
  });

  const result = await callChronosService<ChronosForecastResponse>(
    '/forecast',
    {
      symbol,
      run_window: params.runWindow,
      calibration_mode: params.calibrationMode,
      horizon_specs: horizonSpecs,
    },
    'forecast'
  );

  if (!result.snapshot || !result.raw_payload || !result.raw_payload.horizons) {
    throw new Error('Chronos-2 service returned an incomplete forecast response.');
  }
  if (result.raw_payload.symbol !== symbol) {
    throw new Error(
      \`Chronos-2 returned symbol \${result.raw_payload.symbol}, but \${symbol} was requested.\`
    );
  }

  params.onProgress?.({
    stage: 'synthesis',
    message: \`Amazon Chronos-2 generated \${result.diagnostics?.simulation_paths ?? 0} correlated scenarios across five horizons.\`,
    snapshot: result.snapshot,
    sources: result.sources ?? [],
  });

  const rawPayload = result.raw_payload;
  rawPayload.as_of = nowUtc;
  rawPayload.model = rawPayload.model || 'amazon/chronos-2';
  rawPayload.base_price = Number(rawPayload.base_price);

  // Sizing is disabled by the service until walk-forward calibration establishes
  // that forecast probabilities are reliable enough to support a Kelly estimate.
  rawPayload.execution_signals.kelly_fraction_cap = 0;
  rawPayload.execution_signals.suggested_strategy_weights = {
    momentum_trend: 0,
    mean_reversion: 0,
    volatility_harvesting: 0,
    cash_defensive: 1,
  };

  params.onProgress?.({
    stage: 'audit',
    message: 'Auditing Chronos-2 scenario probabilities, CDF monotonicity, moments, and quantiles...',
    snapshot: result.snapshot,
    sources: result.sources ?? [],
  });

  const { payload, audit } = auditAndReconcileForecast(
    rawPayload,
    result.snapshot.leverage_factor,
    params.calibrationMode
  );

  const record: ForecastRecord = {
    id: crypto.randomUUID(),
    created_at: nowUtc,
    trigger: params.trigger,
    calibration_mode: params.calibrationMode,
    run_window: params.runWindow,
    payload,
    snapshot: result.snapshot,
    sources: result.sources ?? [],
    audit,
  };

  params.onProgress?.({
    stage: 'complete',
    message: 'Chronos-2 forecast and deterministic probability audit completed.',
    snapshot: result.snapshot,
    sources: result.sources ?? [],
  });

  return record;
}

export async function verifyRealizedOutcome(
  record: ForecastRecord
): Promise<RealizedVerification> {
  const baseDate = record.payload.as_of.slice(0, 10);
  const response = await callChronosService<ChronosVerifyResponse>(
    '/verify',
    {
      symbol: record.payload.symbol,
      base_date: baseDate,
    },
    'realized-close verification'
  );

  if (!response.found || !response.actual_close_price || record.payload.base_price <= 0) {
    throw new Error(
      response.notes ||
        \`Realized regular-session close for \${record.payload.symbol} after \${baseDate} is not yet available.\`
    );
  }

  const actualReturnPct = Number(
    (((response.actual_close_price - record.payload.base_price) / record.payload.base_price) * 100).toFixed(2)
  );
  const probPositive = record.payload.horizons.tomorrow.summary.prob_positive;
  const outcomePositive = actualReturnPct > 0 ? 1 : 0;
  const brierScore = Number(Math.pow(probPositive - outcomePositive, 2).toFixed(4));
  const quantiles = record.payload.horizons.tomorrow.summary.quantiles_pct;

  return {
    verified_at: new Date().toISOString(),
    target_horizon: 'tomorrow',
    actual_close_price: Number(response.actual_close_price.toFixed(2)),
    actual_return_pct: actualReturnPct,
    brier_score: brierScore,
    within_iqr_p25_p75: actualReturnPct >= quantiles.p25 && actualReturnPct <= quantiles.p75,
    within_90_p05_p95: actualReturnPct >= quantiles.p05 && actualReturnPct <= quantiles.p95,
    notes: response.notes,
    sources: [
      {
        title: \`Yahoo Finance adjusted close: \${record.payload.symbol}\`,
        uri: \`https://finance.yahoo.com/quote/\${encodeURIComponent(record.payload.symbol)}/history/\`,
        domain: 'finance.yahoo.com',
      },
    ],
  };
}

function getLeverageFactor(symbol: string): number {
  const threeX = new Set(['TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'SOXL', 'SOXS', 'TNA']);
  const twoX = new Set(['QLD', 'QID', 'SSO']);
  if (threeX.has(symbol)) return 3;
  if (twoX.has(symbol)) return 2;
  return 1;
}
