import type { ForecastRecord } from '../../src/types/forecast.ts';

/** Minimal record: only the fields the scheduling code reads are meaningful. */
export function makeRecord(overrides: {
  id?: string;
  symbol?: string;
  createdAt?: string;
  allPassed?: boolean;
  runWindow?: ForecastRecord['run_window'];
  calibration?: ForecastRecord['calibration_mode'];
}): ForecastRecord {
  return {
    id: overrides.id ?? 'rec-1',
    created_at: overrides.createdAt ?? '2026-11-24T09:06:00.000Z',
    trigger: 'scheduled',
    calibration_mode: overrides.calibration ?? 'leveraged_scaled',
    run_window: overrides.runWindow ?? 'pre_market',
    payload: { symbol: overrides.symbol ?? 'TQQQ', base_price: 50 },
    snapshot: {},
    sources: [],
    audit: { all_passed: overrides.allPassed ?? true },
  } as unknown as ForecastRecord;
}
