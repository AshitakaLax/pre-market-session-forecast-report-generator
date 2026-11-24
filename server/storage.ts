import fs from 'fs';
import path from 'path';
import type { ForecastRecord, ScheduleConfig } from '../src/types/forecast.ts';
import { assertValidForecastRecord } from './forecastValidation.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FORECASTS_FILE = path.join(DATA_DIR, 'forecasts.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: false,
  time_et: '04:30',
  trading_days_only: true,
  symbols: ['TQQQ'],
  calibration_mode: 'leveraged_scaled',
  run_window: 'pre_market',
  last_scheduled_run_date_et: null,
  last_run_status: null,
};

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readForecasts(): ForecastRecord[] {
  ensureDataDir();
  if (!fs.existsSync(FORECASTS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(FORECASTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeForecasts(records: ForecastRecord[]): void {
  ensureDataDir();
  const tmp = `${FORECASTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
  fs.renameSync(tmp, FORECASTS_FILE);
}

/**
 * Persist a forecast record. The record must satisfy
 * schemas/forecast-record.schema.json and the semantic probability rules;
 * otherwise a ForecastValidationError is thrown and nothing is written.
 */
export function saveForecast(record: ForecastRecord): void {
  assertValidForecastRecord(record);
  const existing = readForecasts();
  const updated = [record, ...existing.filter((r) => r.id !== record.id)].slice(0, 120);
  writeForecasts(updated);
}

export function getForecastById(id: string): ForecastRecord | undefined {
  return readForecasts().find((r) => r.id === id);
}

export function deleteForecastById(id: string): boolean {
  const existing = readForecasts();
  const next = existing.filter((r) => r.id !== id);
  if (next.length === existing.length) return false;
  writeForecasts(next);
  return true;
}

export function readScheduleConfig(): ScheduleConfig {
  ensureDataDir();
  if (!fs.existsSync(SCHEDULE_FILE)) {
    return { ...DEFAULT_SCHEDULE };
  }
  try {
    const raw = fs.readFileSync(SCHEDULE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SCHEDULE, ...parsed };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export function writeScheduleConfig(config: ScheduleConfig): ScheduleConfig {
  ensureDataDir();
  const merged = { ...DEFAULT_SCHEDULE, ...config };
  const tmp = `${SCHEDULE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tmp, SCHEDULE_FILE);
  return merged;
}
