import type { ScheduleConfig } from '../src/types/forecast.ts';

export const MARKET_OPEN_ET = '09:30';

export type ScheduleDecision =
  | { action: 'run'; reason: string }
  | { action: 'alert_missed'; reason: string }
  | { action: 'skip'; reason: string };

/** Seconds to wait after the n-th failed attempt of the day (n >= 1): 30, 60, 120, 120... */
export function retryBackoffSeconds(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(30 * 2 ** (attempts - 1), 120);
}

export interface DecisionInput {
  config: ScheduleConfig;
  dateEt: string;
  timeEt: string;
  nowMs: number;
  isTradingDay: boolean;
  /** Symbols that still lack a validated record for `dateEt`. */
  pendingSymbols: string[];
}

/**
 * Decides what the in-process scheduler should do on this tick.
 * "Attempted" and "succeeded" are tracked separately, so a failed run is retried
 * with backoff until `retry_cutoff_et`.
 */
export function decideScheduledAction(input: DecisionInput): ScheduleDecision {
  const { config, dateEt, timeEt, nowMs, isTradingDay, pendingSymbols } = input;
  if (!config.enabled) return { action: 'skip', reason: 'disabled' };
  if (config.trading_days_only && !isTradingDay) return { action: 'skip', reason: 'not_trading_day' };
  if (pendingSymbols.length === 0) return { action: 'skip', reason: 'complete' };
  if (timeEt < config.time_et) return { action: 'skip', reason: 'before_start' };

  if (timeEt >= config.retry_cutoff_et) {
    if (timeEt < MARKET_OPEN_ET && config.missed_alert_date_et !== dateEt) {
      return { action: 'alert_missed', reason: 'cutoff_passed_without_validated_record' };
    }
    return { action: 'skip', reason: 'past_cutoff' };
  }

  if (config.attempts_date_et === dateEt && config.last_attempt_at) {
    const wait = retryBackoffSeconds(config.attempts_today) * 1000;
    if (nowMs - Date.parse(config.last_attempt_at) < wait) {
      return { action: 'skip', reason: 'backoff' };
    }
  }
  return { action: 'run', reason: config.attempts_date_et === dateEt ? 'retry' : 'first_attempt' };
}

/**
 * Gate for the external task endpoint. Returns a skip reason, or null to proceed.
 * Running before `time_et` would save a "validated" record without the opening
 * window data and then block the real run, so early triggers (e.g. a UTC cron that
 * fires an hour early outside its DST half of the year) are skipped.
 */
export function taskTriggerSkipReason(input: {
  config: Pick<ScheduleConfig, 'trading_days_only' | 'time_et'>;
  dateEt: string;
  weekday: string;
  timeEt: string;
  isTradingDay: boolean;
  force: boolean;
}): string | null {
  if (input.force) return null;
  if (input.config.trading_days_only && !input.isTradingDay) {
    return `Market closed (${input.dateEt} ${input.weekday} ET). Pass force=true to override.`;
  }
  if (input.timeEt < input.config.time_et) {
    return `Too early (${input.timeEt} ET, start is ${input.config.time_et} ET). Pass force=true to override.`;
  }
  return null;
}
