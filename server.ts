import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  getActiveChronosHealth,
  runForecastPipeline,
  verifyRealizedOutcome,
} from './server/forecastEngine.ts';
import {
  deleteForecastById,
  getForecastById,
  readForecasts,
  readScheduleConfig,
  saveForecast,
  writeScheduleConfig,
} from './server/storage.ts';
import { FORECAST_RECORD_SCHEMA, validateForecastRecord } from './server/forecastValidation.ts';
import { easternClockAt } from './server/easternClock.ts';
import { resolveTradingDayNow } from './server/marketCalendar.ts';
import { notifyMissedDeadline, notifyValidated } from './server/notify.ts';
import {
  createPremarketRunner,
  pendingSymbols,
  type SymbolResult,
} from './server/premarketRunner.ts';
import { decideScheduledAction, taskTriggerSkipReason } from './server/scheduler.ts';
import type { CalibrationMode, RunWindow, ScheduleConfig } from './src/types/forecast.ts';

const PORT = 3000;

const FORMAT_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const runner = createPremarketRunner({
  runPipeline: runForecastPipeline,
  readForecasts,
  saveForecast,
});

async function getClock() {
  const base = easternClockAt();
  const day = await resolveTradingDayNow(base);
  return {
    ...base,
    isTradingDay: day.isTradingDay,
    earlyClose: day.earlyClose,
    closeEt: day.closeEt,
    calendarBasis: day.basis,
  };
}

type Clock = Awaited<ReturnType<typeof getClock>>;

function configuredSymbols(config: ScheduleConfig): string[] {
  return config.symbols.length > 0 ? config.symbols : ['TQQQ'];
}

/**
 * Runs (or reuses) today's validated record for each symbol and records the outcome.
 * "Attempted" and "succeeded" are tracked separately so failures are retried.
 */
async function executeBatch(opts: {
  symbols: string[];
  clock: Clock;
  config: ScheduleConfig;
  trigger: 'manual' | 'scheduled';
  label: string;
  idempotencyKey?: string;
  force?: boolean;
}): Promise<SymbolResult[]> {
  const { symbols, clock, config, label } = opts;
  const batch = {
    symbols,
    dateEt: clock.dateEt,
    calibrationMode: config.calibration_mode,
    runWindow: config.run_window,
    trigger: opts.trigger,
    idempotencyKey: opts.idempotencyKey,
    force: opts.force,
  };

  const needsWork =
    opts.force || pendingSymbols(readForecasts(), batch).length > 0 || Boolean(opts.idempotencyKey);
  if (needsWork) {
    const cur = readScheduleConfig();
    writeScheduleConfig({
      ...cur,
      last_scheduled_run_date_et: clock.dateEt,
      attempts_date_et: clock.dateEt,
      attempts_today: cur.attempts_date_et === clock.dateEt ? cur.attempts_today + 1 : 1,
      last_attempt_at: new Date().toISOString(),
      last_run_status: `${label} running at ${clock.timeEt} ET...`,
    });
  }

  const results = await runner.runBatch(batch);
  const failed = results.filter((r) => r.status === 'failed');
  const latest = readScheduleConfig();
  const allConfiguredDone =
    pendingSymbols(readForecasts(), { ...batch, symbols: configuredSymbols(latest) }).length === 0;

  if (failed.length === 0 && allConfiguredDone) {
    writeScheduleConfig({
      ...latest,
      last_successful_run_date_et: clock.dateEt,
      last_run_status: `${label} validated ${symbols.join(', ')} for ${clock.dateEt}`,
    });
    if (results.some((r) => r.status === 'created')) {
      await notifyValidated(clock.dateEt, symbols);
    }
  } else if (failed.length > 0) {
    writeScheduleConfig({
      ...latest,
      last_run_status: `${label} failed at ${clock.dateEt} ${clock.timeEt} ET: ${failed
        .map((f) => `${f.symbol}: ${f.error}`)
        .join('; ')}`,
    });
  }
  return results;
}

let schedulerRunning = false;

async function checkAndRunScheduledForecasts(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const config = readScheduleConfig();
    if (!config.enabled) return;

    const clock = await getClock();
    const symbols = configuredSymbols(config);
    const decision = decideScheduledAction({
      config,
      dateEt: clock.dateEt,
      timeEt: clock.timeEt,
      nowMs: Date.now(),
      isTradingDay: clock.isTradingDay,
      pendingSymbols: pendingSymbols(readForecasts(), {
        symbols,
        dateEt: clock.dateEt,
        calibrationMode: config.calibration_mode,
        runWindow: config.run_window,
      }),
    });

    if (decision.action === 'run') {
      await executeBatch({ symbols, clock, config, trigger: 'scheduled', label: 'Scheduled batch' });
    } else if (decision.action === 'alert_missed') {
      const missing = pendingSymbols(readForecasts(), {
        symbols,
        dateEt: clock.dateEt,
        calibrationMode: config.calibration_mode,
        runWindow: config.run_window,
      });
      writeScheduleConfig({
        ...readScheduleConfig(),
        missed_alert_date_et: clock.dateEt,
      });
      await notifyMissedDeadline(clock.dateEt, missing, readScheduleConfig().last_run_status);
    }
  } catch (err) {
    console.error('Scheduler tick failed:', err);
  } finally {
    schedulerRunning = false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (_req, res) => {
    const clock = await getClock();
    const chronos = await getActiveChronosHealth();

    res.json({
      status: chronos.model_loaded === true ? 'ok' : 'degraded',
      forecasting_engine: 'amazon/chronos-2',
      chronos,
      eastern_clock: clock,
    });
  });

  app.get('/api/forecasts', (_req, res) => {
    res.json({ forecasts: readForecasts() });
  });

  // JSON Schema (draft 2020-12) that every persisted forecast record satisfies.
  app.get('/api/schemas/forecast-record', (_req, res) => {
    res.type('application/schema+json').send(JSON.stringify(FORECAST_RECORD_SCHEMA, null, 2));
  });

  // Validate an arbitrary forecast record (schema + cross-field probability rules).
  app.post('/api/forecasts/validate', (req, res) => {
    const outcome = validateForecastRecord(req.body);
    res.status(outcome.valid ? 200 : 422).json(outcome);
  });

  app.get('/api/forecasts/:id', (req, res) => {
    const record = getForecastById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Forecast record not found.' });
      return;
    }
    res.json({ forecast: record });
  });

  app.delete('/api/forecasts/:id', (req, res) => {
    const removed = deleteForecastById(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Forecast record not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  app.post('/api/forecasts/run', async (req, res) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : 'TQQQ';
    const calibrationMode: CalibrationMode =
      req.body?.calibrationMode === 'original_1x' ? 'original_1x' : 'leveraged_scaled';
    const runWindow: RunWindow =
      req.body?.runWindow === 'pre_bell' || req.body?.runWindow === 'eod'
        ? req.body.runWindow
        : 'pre_market';

    const wantsStream =
      req.query.stream === '1' || req.headers.accept?.includes('text/event-stream');

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const record = await runForecastPipeline({
          symbol,
          calibrationMode,
          runWindow,
          trigger: 'manual',
          onProgress: (progress) => {
            sendEvent('progress', progress);
          },
        });
        saveForecast(record);
        sendEvent('result', { forecast: record });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Forecast generation failed.';
        sendEvent('error', { error: message });
      } finally {
        res.end();
      }
      return;
    }

    try {
      const record = await runForecastPipeline({
        symbol,
        calibrationMode,
        runWindow,
        trigger: 'manual',
      });
      saveForecast(record);
      res.json({ forecast: record });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forecast generation failed.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/forecasts/:id/verify', async (req, res) => {
    const record = getForecastById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Forecast record not found.' });
      return;
    }
    try {
      const verification = await verifyRealizedOutcome(record);
      const updated = { ...record, verification };
      saveForecast(updated);
      res.json({ forecast: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed.';
      res.status(422).json({ error: message });
    }
  });

  function authorizeTask(req: express.Request, res: express.Response): boolean {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized task trigger.' });
      return false;
    }
    return true;
  }

  // Headless scheduled task endpoint for Cloud Scheduler / GitHub Actions / cron.
  // Idempotent per ET date + symbol: a repeat trigger returns the existing validated
  // record. Non-2xx on failure so the scheduler's own retry policy kicks in.
  app.post('/api/tasks/premarket', async (req, res) => {
    if (!authorizeTask(req, res)) return;

    const clock = await getClock();
    const config = readScheduleConfig();
    const force = req.body?.force === true || req.query.force === '1';

    const skipReason = taskTriggerSkipReason({
      config,
      dateEt: clock.dateEt,
      weekday: clock.weekday,
      timeEt: clock.timeEt,
      isTradingDay: clock.isTradingDay,
      force,
    });
    if (skipReason) {
      res.json({ skipped: true, reason: skipReason, eastern_clock: clock });
      return;
    }

    const symbols: string[] =
      Array.isArray(req.body?.symbols) && req.body.symbols.length > 0
        ? req.body.symbols.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean)
        : configuredSymbols(config);

    const headerKey = req.headers['x-cloudscheduler-scheduletime'] ?? req.headers['idempotency-key'];
    const idempotencyKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey)?.slice(0, 200);

    try {
      const results = await executeBatch({
        symbols,
        clock,
        config,
        trigger: 'scheduled',
        label: 'External task',
        idempotencyKey,
        force,
      });
      const failed = results.filter((r) => r.status === 'failed');
      const body = {
        completed: failed.length === 0,
        already_complete: results.every((r) => r.status === 'existing'),
        idempotency_key: idempotencyKey ?? null,
        eastern_clock: clock,
        forecasts: results
          .filter((r) => r.record)
          .map((r) => ({
            status: r.status,
            id: r.record!.id,
            symbol: r.record!.payload.symbol,
            as_of: r.record!.payload.as_of,
            base_price: r.record!.payload.base_price,
            regime: r.record!.payload.execution_signals.regime,
            kelly_fraction_cap: r.record!.payload.execution_signals.kelly_fraction_cap,
            tomorrow_mean_pct: r.record!.payload.horizons.tomorrow.summary.mean_pct,
            tomorrow_prob_positive: r.record!.payload.horizons.tomorrow.summary.prob_positive,
          })),
        failures: failed.map((f) => ({ symbol: f.symbol, error: f.error })),
      };
      res.status(failed.length === 0 ? 200 : 500).json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scheduled task failed.';
      res.status(500).json({ error: message });
    }
  });

  // Read-only: does every configured symbol have a validated record for today (ET)?
  app.get('/api/tasks/premarket/status', async (req, res) => {
    if (!authorizeTask(req, res)) return;
    const clock = await getClock();
    const config = readScheduleConfig();
    const pending = pendingSymbols(readForecasts(), {
      symbols: configuredSymbols(config),
      dateEt: clock.dateEt,
      calibrationMode: config.calibration_mode,
      runWindow: config.run_window,
    });
    res.status(pending.length === 0 || !clock.isTradingDay ? 200 : 503).json({
      date_et: clock.dateEt,
      trading_day: clock.isTradingDay,
      validated: pending.length === 0,
      pending_symbols: pending,
      last_run_status: config.last_run_status,
    });
  });

  app.get('/api/schedule', async (_req, res) => {
    res.json({
      schedule: readScheduleConfig(),
      eastern_clock: await getClock(),
    });
  });

  app.put('/api/schedule', async (req, res) => {
    const body = req.body as Partial<ScheduleConfig>;
    const current = readScheduleConfig();
    const cleanedSymbols = Array.isArray(body.symbols)
      ? body.symbols
          .map((s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, ''))
          .filter(Boolean)
          .slice(0, 6)
      : current.symbols;

    const timeEt =
      typeof body.time_et === 'string' && FORMAT_HHMM.test(body.time_et)
        ? body.time_et
        : current.time_et;
    const cutoffEt =
      typeof body.retry_cutoff_et === 'string' && FORMAT_HHMM.test(body.retry_cutoff_et)
        ? body.retry_cutoff_et
        : current.retry_cutoff_et;

    if (timeEt >= cutoffEt) {
      res.status(400).json({
        error: `Start time (${timeEt} ET) must be before the retry cutoff (${cutoffEt} ET).`,
      });
      return;
    }

    const updated = writeScheduleConfig({
      ...current,
      retry_cutoff_et: cutoffEt,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      time_et: timeEt,
      trading_days_only:
        typeof body.trading_days_only === 'boolean'
          ? body.trading_days_only
          : current.trading_days_only,
      symbols: cleanedSymbols.length > 0 ? cleanedSymbols : ['TQQQ'],
      calibration_mode:
        body.calibration_mode === 'original_1x' || body.calibration_mode === 'leveraged_scaled'
          ? body.calibration_mode
          : current.calibration_mode,
      run_window:
        body.run_window === 'pre_market' ||
        body.run_window === 'pre_bell' ||
        body.run_window === 'eod'
          ? body.run_window
          : current.run_window,
    });

    res.json({
      schedule: updated,
      eastern_clock: await getClock(),
    });
  });

  // Start background pre-market scheduler check every 30s
  setInterval(() => {
    void checkAndRunScheduledForecasts();
  }, 30_000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Quant server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
