// Dates are stored in UTC and shown in South African time.
// South Africa has no daylight saving, so SAST is always UTC+2.
const OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The wall-clock parts of a UTC instant, in SAST. */
function sast(d: Date) {
  const x = new Date(d.getTime() + OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), h: x.getUTCHours(), min: x.getUTCMinutes() };
}

/** The UTC instant for a SAST wall-clock time. Month is 0-based. */
export function fromSast(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min) - OFFSET_MS);
}

/** Midnight SAST at the start of the day containing `d`. */
export function startOfSastDay(d: Date): Date {
  const p = sast(d);
  return fromSast(p.y, p.m, p.d);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Calendar days from today to `d`, both in SAST: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFrom(now: Date, d: Date): number {
  return Math.round((startOfSastDay(d).getTime() - startOfSastDay(now).getTime()) / DAY_MS);
}

/** "Thu 22 Oct" */
export function fmtDay(d: Date): string {
  const p = sast(d);
  return `${DOW[p.dow]} ${p.d} ${MON[p.m]}`;
}

/** "11:00" */
export function fmtTime(d: Date): string {
  const p = sast(d);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

/** "Tomorrow, 11:00" or "Thu 22 Oct, 11:00" */
export function fmtCloses(now: Date, d: Date): string {
  const n = daysFrom(now, d);
  const day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(d);
  return `${day}, ${fmtTime(d)}`;
}

/** "Tue 27 Oct at 10:00" */
export function fmtDayAt(d: Date): string {
  return `${fmtDay(d)} at ${fmtTime(d)}`;
}

/** "today at 19:40", "yesterday at 19:40" or "Thu 22 Oct at 19:40" */
export function fmtWhen(now: Date, d: Date): string {
  const n = daysFrom(now, d);
  const day = n === 0 ? 'today' : n === -1 ? 'yesterday' : fmtDay(d);
  return `${day} at ${fmtTime(d)}`;
}

/** The SAST year, for registers and results. */
export function sastYear(d: Date): number {
  return sast(d).y;
}

/** "2026-10-22", the SAST calendar date, as the eTenders API takes it. */
export function sastDate(d: Date): string {
  const p = sast(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
