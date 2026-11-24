import type { CalibrationMode, ForecastRecord, RunWindow } from '../src/types/forecast.ts';
import { easternDateOf } from './easternClock.ts';

export interface PipelineParams {
  symbol: string;
  calibrationMode: CalibrationMode;
  runWindow: RunWindow;
  trigger: 'manual' | 'scheduled';
}

export interface RunnerDeps {
  runPipeline: (params: PipelineParams) => Promise<ForecastRecord>;
  readForecasts: () => ForecastRecord[];
  saveForecast: (record: ForecastRecord) => void;
}

export interface BatchOptions {
  symbols: string[];
  dateEt: string;
  calibrationMode: CalibrationMode;
  runWindow: RunWindow;
  trigger: 'manual' | 'scheduled';
  idempotencyKey?: string;
  /** Ignore existing records and generate a fresh one. */
  force?: boolean;
}

export type SymbolStatus = 'existing' | 'created' | 'failed';

export interface SymbolResult {
  symbol: string;
  status: SymbolStatus;
  record?: ForecastRecord;
  error?: string;
}

/** A record only counts as the day's report if its deterministic audit passed. */
export function isValidatedRecord(record: ForecastRecord): boolean {
  return record.audit?.all_passed === true && Number(record.payload?.base_price) > 0;
}

export function findValidatedRecord(
  records: ForecastRecord[],
  match: {
    symbol: string;
    dateEt: string;
    calibrationMode: CalibrationMode;
    runWindow: RunWindow;
  }
): ForecastRecord | undefined {
  return records.find(
    (r) =>
      r.payload?.symbol === match.symbol &&
      r.run_window === match.runWindow &&
      r.calibration_mode === match.calibrationMode &&
      easternDateOf(r.created_at) === match.dateEt &&
      isValidatedRecord(r)
  );
}

export function pendingSymbols(
  records: ForecastRecord[],
  opts: Pick<BatchOptions, 'symbols' | 'dateEt' | 'calibrationMode' | 'runWindow'>
): string[] {
  return opts.symbols.filter(
    (symbol) =>
      !findValidatedRecord(records, {
        symbol,
        dateEt: opts.dateEt,
        calibrationMode: opts.calibrationMode,
        runWindow: opts.runWindow,
      })
  );
}

/**
 * Idempotent per ET date + symbol (+ window + calibration). Concurrent triggers - the
 * in-process scheduler plus a Cloud Scheduler retry - share one in-flight run instead
 * of both generating a record.
 */
export function createPremarketRunner(deps: RunnerDeps) {
  const inFlight = new Map<string, Promise<SymbolResult>>();

  async function runSymbol(symbol: string, opts: BatchOptions): Promise<SymbolResult> {
    const records = deps.readForecasts();

    if (opts.idempotencyKey) {
      const byKey = records.find(
        (r) => r.idempotency_key === opts.idempotencyKey && r.payload?.symbol === symbol
      );
      if (byKey) return { symbol, status: 'existing', record: byKey };
    }
    if (!opts.force) {
      const existing = findValidatedRecord(records, { ...opts, symbol });
      if (existing) return { symbol, status: 'existing', record: existing };
    }

    try {
      const record = await deps.runPipeline({
        symbol,
        calibrationMode: opts.calibrationMode,
        runWindow: opts.runWindow,
        trigger: opts.trigger,
      });
      if (!isValidatedRecord(record)) {
        return {
          symbol,
          status: 'failed',
          error: 'Forecast generated but failed the deterministic probability audit; not published.',
        };
      }
      if (opts.idempotencyKey) record.idempotency_key = opts.idempotencyKey;
      deps.saveForecast(record);
      return { symbol, status: 'created', record };
    } catch (err) {
      return {
        symbol,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Forecast generation failed.',
      };
    }
  }

  async function runBatch(opts: BatchOptions): Promise<SymbolResult[]> {
    const results: SymbolResult[] = [];
    for (const symbol of opts.symbols) {
      const key = `${opts.dateEt}|${symbol}|${opts.runWindow}|${opts.calibrationMode}`;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = runSymbol(symbol, opts).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      results.push(await pending);
    }
    return results;
  }

  return { runBatch };
}
