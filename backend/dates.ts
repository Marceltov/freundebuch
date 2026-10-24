// Calendar dates as plain `YYYY-MM-DD` strings (or `--MM-DD` for a yearly date without a year). No time zones inside: only
// `today` knows about TZ, and everything else counts whole days on the calendar.
import { config } from "./config";
import { InvalidInputError } from "./errors";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEARLESS = /^--(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const validMonthDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `YYYY-MM-DD` that exists on the calendar. */
export function isDay(s: string): boolean {
  const m = DAY.exec(s);
  return !!m && validMonthDay(+m[1], +m[2], +m[3]);
}

/** `--MM-DD` that exists in some year; 29 Feb counts. */
export function isYearless(s: string): boolean {
  const m = YEARLESS.exec(s);
  return !!m && validMonthDay(2000, +m[1], +m[2]);
}

/** The one date check for input: throws `InvalidInputError` unless `value` is a real `YYYY-MM-DD`. */
export function assertDay(value: string, what: string): void {
  if (!isDay(value)) throw new InvalidInputError(`${what} must be a real date as YYYY-MM-DD, got "${value}"`);
}

/** Month, day and the year when there is one; throws `InvalidInputError` for anything that isn't a real date. */
function parse(date: string): { year: number | null; month: number; day: number } {
  const y = DAY.exec(date);
  if (y && isDay(date)) return { year: +y[1], month: +y[2], day: +y[3] };
  const n = YEARLESS.exec(date);
  if (n && isYearless(date)) return { year: null, month: +n[1], day: +n[2] };
  throw new InvalidInputError(`Not a real date: "${date}" (expected YYYY-MM-DD or --MM-DD)`);
}

const epochDay = (year: number, month: number, day: number) => {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return Math.round(t.getTime() / MS_PER_DAY);
};

/** Today's date in the configured time zone (`TZ`), not UTC: just after local midnight it is already the next day. */
export function today(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (x.year === null || y.year === null) throw new InvalidInputError("daysBetween needs full dates (YYYY-MM-DD)");
  return epochDay(y.year, y.month, y.day) - epochDay(x.year, x.month, x.day);
}

/** The first day on or after `from` on which the date's month and day fall. 29 Feb falls on 28 Feb in a non-leap year. */
export function nextOccurrence(date: string, from: string): string {
  const d = parse(date);
  const f = parse(from);
  if (f.year === null) throw new InvalidInputError("nextOccurrence needs a full `from` date (YYYY-MM-DD)");
  const inYear = (y: number) => {
    const day = d.month === 2 && d.day === 29 && !isLeap(y) ? 28 : d.day;
    return `${pad(y, 4)}-${pad(d.month)}-${pad(day)}`;
  };
  const thisYear = inYear(f.year);
  return thisYear >= from ? thisYear : inYear(f.year + 1);
}

/** The age reached on `on`, or null for a date without a year (or one that lies after `on`). A 29 Feb birthday counts on 28 Feb. */
export function ageOn(date: string, on: string): number | null {
  const d = parse(date);
  const o = parse(on);
  if (d.year === null || o.year === null) return null;
  const birthday = nextOccurrence(`--${pad(d.month)}-${pad(d.day)}`, `${pad(o.year, 4)}-01-01`);
  const age = o.year - d.year - (on < birthday ? 1 : 0);
  return age < 0 ? null : age;
}
