// The fetch schedule, shared by the worker (to run it) and the app (to say when the next run is).
import { fromSast, addDays, startOfSastDay } from './dates.ts';

export const TIMEZONE = 'Africa/Johannesburg';
/** Every 2 hours on weekdays, 07:00 to 19:00. */
export const FETCH_DAYTIME_CRON = '0 7-19/2 * * 1-5';
/** Once overnight, every day. */
export const FETCH_OVERNIGHT_CRON = '0 2 * * *';

const DAYTIME_HOURS = [7, 9, 11, 13, 15, 17, 19];
const OVERNIGHT_HOUR = 2;

/** The next scheduled fetch after `now`. */
export function nextFetchAt(now: Date): Date {
  const today = startOfSastDay(now);
  for (let i = 0; i < 8; i++) {
    const day = addDays(today, i);
    const p = new Date(day.getTime() + 2 * 3600 * 1000); // SAST wall clock of that midnight
    const dow = p.getUTCDay();
    const hours = [OVERNIGHT_HOUR, ...(dow >= 1 && dow <= 5 ? DAYTIME_HOURS : [])];
    for (const h of hours) {
      const at = fromSast(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), h);
      if (at > now) return at;
    }
  }
  return now;
}
