/** Campaign times are wall-clock times in Morocco (the server schedules in the same zone), whatever the admin's device zone is. */
export const CAMPAIGN_TZ = 'Africa/Casablanca';
const MIN = 60000;
const cache = new Map<string, Intl.DateTimeFormat>();
export type Parts = { y: number; m: number; d: number; h: number; min: number };
export function partsOf(ts: number, tz = CAMPAIGN_TZ): Parts {
  try {
    let f = cache.get(tz);
    if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); cache.set(tz, f); }
    const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
  } catch {
    const d = new Date(ts); // engines without time-zone data: device time
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes() };
  }
}
const offsetAt = (ts: number, tz: string) => { const p = partsOf(ts, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / MIN) * MIN; };
/** Epoch of a Moroccan wall-clock time. */
export function zonedEpoch(y: number, m: number, d: number, hh: number, mm: number, tz = CAMPAIGN_TZ) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}
const pad = (n: number) => String(n).padStart(2, '0');
export const dateInput = (ts: number) => { const p = partsOf(ts); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const timeInput = (ts: number) => { const p = partsOf(ts); return `${pad(p.h)}:${pad(p.min)}`; };
/** "2026-10-28" + "09:30" -> epoch, or null when malformed / not a real date. */
export function parseWhen(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim()), t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, m, day] = [+d[1], +d[2], +d[3]];
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return null;
  return zonedEpoch(y, m, day, +t[1], +t[2]);
}
export const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
/** Short, readable date + time in Morocco ("28/10 10:00"). */
export function formatWhen(ts: number) { const p = partsOf(ts); return `${pad(p.d)}/${pad(p.m)} ${pad(p.h)}:${pad(p.min)}`; }
/** Today + `days` at hh:mm (Morocco), as a ready-to-use epoch. */
export function atDay(days: number, hh: number, mm = 0, now = Date.now()) {
  const p = partsOf(now);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return zonedEpoch(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
}
