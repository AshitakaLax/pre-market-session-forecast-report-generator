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
  readForecastsForDisplay,
  StorageCorruptionError,
  readScheduleConfig,
  saveForecast,
  writeScheduleConfig,
} from './server/storage.ts';
import type { CalibrationMode, RunWindow, ScheduleConfig } from './src/types/forecast.ts';

const PORT = 3000;

// Major NYSE/Nasdaq fixed + observed holidays (YYYY-MM-DD in ET)
const US_MARKET_HOLIDAYS = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
]);

function getEasternClock(): {
  dateEt: string;
  timeEt: string;
  weekday: string;
  isTradingDay: boolean;
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
  const dateEt = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = get('hour') === '24' ? '00' : get('hour');
  const timeEt = `${hour}:${get('minute')}`;

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isHoliday = US_MARKET_HOLIDAYS.has(dateEt);

  return {
    dateEt,
    timeEt,
    weekday,
    isTradingDay: !isWeekend && !isHoliday,
  };
}

let schedulerRunning = false;

async function checkAndRunScheduledForecasts(): Promise<void> {
  if (schedulerRunning) return;
  let config;
  try {
    config = readScheduleConfig();
  } catch (err) {
    console.error(`[scheduler] Skipping run: ${err instanceof Error ? err.message : err}`);
    return;
  }
  if (!config.enabled) return;

  const clock = getEasternClock();
  if (config.trading_days_only && !clock.isTradingDay) return;
  if (config.last_scheduled_run_date_et === clock.dateEt) return;
  if (clock.timeEt < config.time_et) return;

  schedulerRunning = true;
  try {
    writeScheduleConfig({
      ...config,
      last_scheduled_run_date_et: clock.dateEt,
      last_run_status: `Running scheduled pre-market batch at ${clock.timeEt} ET...`,
    });

    const symbols = config.symbols.length > 0 ? config.symbols : ['TQQQ'];
    for (const sym of symbols) {
      const record = await runForecastPipeline({
        symbol: sym,
        calibrationMode: config.calibration_mode,
        runWindow: config.run_window,
        trigger: 'scheduled',
      });
      saveForecast(record);
    }

    const latest = readScheduleConfig();
    writeScheduleConfig({
      ...latest,
      last_scheduled_run_date_et: clock.dateEt,
      last_run_status: `Completed ${symbols.join(', ')} at ${clock.dateEt} ${clock.timeEt} ET`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scheduled run failed';
    const latest = readScheduleConfig();
    writeScheduleConfig({
      ...latest,
      last_run_status: `Failed at ${clock.dateEt} ${clock.timeEt} ET: ${message}`,
    });
  } finally {
    schedulerRunning = false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', async (_req, res) => {
    const clock = getEasternClock();
    const chronos = await getActiveChronosHealth();

    res.json({
      status: chronos.model_loaded === true ? 'ok' : 'degraded',
      forecasting_engine: 'amazon/chronos-2',
      chronos,
      eastern_clock: clock,
    });
  });

  app.get('/api/forecasts', (_req, res) => {
    res.json(readForecastsForDisplay());
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
    try {
      const record = getForecastById(req.params.id);
      if (!record) {
        res.status(404).json({ error: 'Forecast record not found.' });
        return;
      }
      const verification = await verifyRealizedOutcome(record);
      const updated = { ...record, verification };
      saveForecast(updated);
      res.json({ forecast: updated });
    } catch (err) {
      if (err instanceof StorageCorruptionError) {
        res.status(503).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Verification failed.';
      res.status(422).json({ error: message });
    }
  });

  // Headless scheduled task endpoint for Cloud Scheduler / GitHub Actions / cron
  app.post('/api/tasks/premarket', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${cronSecret}`) {
        res.status(401).json({ error: 'Unauthorized task trigger.' });
        return;
      }
    }

    const clock = getEasternClock();
    let config: ScheduleConfig;
    try {
      config = readScheduleConfig();
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'Schedule unreadable.' });
      return;
    }
    const force = req.body?.force === true || req.query.force === '1';

    if (!force && config.trading_days_only && !clock.isTradingDay) {
      res.json({
        skipped: true,
        reason: `Market closed (${clock.dateEt} ${clock.weekday} ET). Pass force=true to override.`,
        eastern_clock: clock,
      });
      return;
    }

    const symbols =
      Array.isArray(req.body?.symbols) && req.body.symbols.length > 0
        ? req.body.symbols.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean)
        : config.symbols.length > 0
          ? config.symbols
          : ['TQQQ'];

    try {
      const results = [];
      for (const sym of symbols) {
        const record = await runForecastPipeline({
          symbol: sym,
          calibrationMode: config.calibration_mode,
          runWindow: config.run_window,
          trigger: 'scheduled',
        });
        saveForecast(record);
        results.push({
          id: record.id,
          symbol: record.payload.symbol,
          as_of: record.payload.as_of,
          base_price: record.payload.base_price,
          regime: record.payload.execution_signals.regime,
          kelly_fraction_cap: record.payload.execution_signals.kelly_fraction_cap,
          tomorrow_mean_pct: record.payload.horizons.tomorrow.summary.mean_pct,
          tomorrow_prob_positive: record.payload.horizons.tomorrow.summary.prob_positive,
        });
      }

      writeScheduleConfig({
        ...config,
        last_scheduled_run_date_et: clock.dateEt,
        last_run_status: `External task completed ${symbols.join(', ')} at ${clock.dateEt} ${clock.timeEt} ET`,
      });

      res.json({
        completed: true,
        eastern_clock: clock,
        forecasts: results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scheduled task failed.';
      if (err instanceof StorageCorruptionError) {
        res.status(503).json({ error: message });
        return;
      }
      writeScheduleConfig({
        ...config,
        last_run_status: `External task failed at ${clock.dateEt} ${clock.timeEt} ET: ${message}`,
      });
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/schedule', (_req, res) => {
    res.json({
      schedule: readScheduleConfig(),
      eastern_clock: getEasternClock(),
    });
  });

  app.put('/api/schedule', (req, res) => {
    const body = req.body as Partial<ScheduleConfig>;
    const current = readScheduleConfig();
    const cleanedSymbols = Array.isArray(body.symbols)
      ? body.symbols
          .map((s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, ''))
          .filter(Boolean)
          .slice(0, 6)
      : current.symbols;

    const timeEt =
      typeof body.time_et === 'string' && /^\d{2}:\d{2}$/.test(body.time_et)
        ? body.time_et
        : current.time_et;

    const updated = writeScheduleConfig({
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
      last_scheduled_run_date_et: current.last_scheduled_run_date_et,
      last_run_status: current.last_run_status,
    });

    res.json({
      schedule: updated,
      eastern_clock: getEasternClock(),
    });
  });

  // Corrupt data files surface as 503 with a clear message; nothing is overwritten.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof StorageCorruptionError) {
      console.error(`[storage] ${err.message}`);
      res.status(503).json({ error: err.message });
      return;
    }
    next(err);
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
