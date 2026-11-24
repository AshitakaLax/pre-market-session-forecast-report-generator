const ET_ZONE = 'America/New_York';

export interface EasternClock {
  dateEt: string;
  timeEt: string;
  weekday: string;
}

/** Eastern wall-clock date/time for an instant. `now` is injectable for tests. */
export function easternClockAt(now: Date = new Date()): EasternClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_ZONE,
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
    timeZone: ET_ZONE,
    weekday: 'short',
  }).format(now);
  return {
    dateEt: `${get('year')}-${get('month')}-${get('day')}`,
    timeEt: `${hour}:${get('minute')}`,
    weekday,
  };
}

/** ET calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function easternDateOf(iso: string): string {
  return easternClockAt(new Date(iso)).dateEt;
}
