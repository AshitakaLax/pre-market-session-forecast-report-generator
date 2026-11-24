import fs from 'fs';
import path from 'path';
import type { ForecastRecord, ScheduleConfig } from '../src/types/forecast.ts';

/** Data directory; override with FORECAST_DATA_DIR (evaluated on every call so tests can swap it). */
function dataDir(): string {
  return path.resolve(process.env.FORECAST_DATA_DIR || path.join(process.cwd(), 'data'));
}
const forecastsFile = () => path.join(dataDir(), 'forecasts.json');
const scheduleFile = () => path.join(dataDir(), 'schedule.json');

/**
 * Thrown when a store file exists but cannot be read or has an invalid shape.
 * Writers must never "recover" from this by writing over the file.
 */
export class StorageCorruptionError extends Error {
  readonly file: string;
  constructor(file: string, reason: string) {
    super(
      `Data file ${file} exists but is unreadable or invalid (${reason}). ` +
        'Refusing to continue so existing data is not overwritten. Fix or move the file aside.',
    );
    this.name = 'StorageCorruptionError';
    this.file = file;
  }
}

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
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Returns undefined if the file does not exist; throws StorageCorruptionError if present but invalid. */
function readJsonFile(file: string, validate: (v: unknown) => string | null): unknown | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new StorageCorruptionError(file, `read failed: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StorageCorruptionError(file, `invalid JSON: ${(err as Error).message}`);
  }
  const problem = validate(parsed);
  if (problem) throw new StorageCorruptionError(file, problem);
  return parsed;
}

const validateForecastList = (v: unknown) => (Array.isArray(v) ? null : 'expected a JSON array');
const validateScheduleObject = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? null : 'expected a JSON object';

/** Copy the current (valid) file to <file>.bak before replacing it. A corrupt file never replaces the backup. */
function backupIfValid(file: string, validate: (v: unknown) => string | null): void {
  try {
    if (readJsonFile(file, validate) !== undefined) fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // Existing file is invalid: keep the previous .bak untouched.
  }
}

function atomicWrite(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/** Strict read: [] only when the file does not exist. Throws StorageCorruptionError otherwise. */
export function readForecasts(): ForecastRecord[] {
  ensureDataDir();
  const parsed = readJsonFile(forecastsFile(), validateForecastList);
  return (parsed as ForecastRecord[] | undefined) ?? [];
}

/** Read-only, never throws on corruption: for display endpoints. Must not feed a writer. */
export function readForecastsForDisplay(): { forecasts: ForecastRecord[]; warning?: string } {
  try {
    return { forecasts: readForecasts() };
  } catch (err) {
    if (err instanceof StorageCorruptionError) {
      console.error(`[storage] ${err.message}`);
      return { forecasts: [], warning: err.message };
    }
    throw err;
  }
}

export function writeForecasts(records: ForecastRecord[]): void {
  ensureDataDir();
  const file = forecastsFile();
  backupIfValid(file, validateForecastList);
  atomicWrite(file, records);
}

export function saveForecast(record: ForecastRecord): void {
  const existing = readForecasts(); // throws on a corrupt store, so we never overwrite it
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

/** Strict read: defaults only when the file does not exist. Throws StorageCorruptionError otherwise. */
export function readScheduleConfig(): ScheduleConfig {
  ensureDataDir();
  const parsed = readJsonFile(scheduleFile(), validateScheduleObject);
  return { ...DEFAULT_SCHEDULE, ...((parsed as Partial<ScheduleConfig> | undefined) ?? {}) };
}

export function writeScheduleConfig(config: ScheduleConfig): ScheduleConfig {
  ensureDataDir();
  const merged = { ...DEFAULT_SCHEDULE, ...config };
  const file = scheduleFile();
  backupIfValid(file, validateScheduleObject);
  atomicWrite(file, merged);
  return merged;
}
