/**
 * Calendar math in a clinic's IANA time zone using only Intl (no dependency).
 * Dates are "YYYY-MM-DD" strings in local clinic time; instants are JS Dates (UTC).
 */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(v: unknown): v is LocalDate {
  if (typeof v !== "string") return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

function parts(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(instant)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (Tashkent: +5h). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of local `date` at `minuteOfDay` in `timeZone`. Handles DST shifts. */
export function localToInstant(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error("Invalid local date");
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 0, minuteOfDay);
  let t = naive - zoneOffsetMs(new Date(naive), timeZone);
  t = naive - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
}

/** Local calendar date of an instant in `timeZone`. */
export function instantToLocalDate(instant: Date, timeZone: string): LocalDate {
  const p = parts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function todayIn(timeZone: string, now = new Date()): LocalDate {
  return instantToLocalDate(now, timeZone);
}

/** ISO weekday of a local date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const m = DATE_RE.exec(date)!;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const m = DATE_RE.exec(date)!;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + days));
  return d.toISOString().slice(0, 10);
}

/** "09:30" ⇄ 570 */
export function parseHm(v: string): number | null {
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(v.trim());
  if (!m) return null;
  const minutes = +m[1]! * 60 + +m[2]!;
  return minutes <= 1440 ? minutes : null;
}

export function formatHm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A DATE column value (UTC midnight) for a local date. */
export function localDateToDbDate(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function dbDateToLocalDate(d: Date): LocalDate {
  return d.toISOString().slice(0, 10);
}
