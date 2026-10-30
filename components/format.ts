import type { Copy } from "@/components/copy";

// Dates for people, in the viewer's language (`copy.locale`). Days are `YYYY-MM-DD` on the calendar, so they are formatted in
// UTC: no zone may shift them.
const at = (day: string) => new Date(`${day}T00:00:00Z`);
const fill = (s: string, n: number | string) => s.replace("{n}", String(n));

/** "Mo., 20. Okt." */
export const shortDay = (copy: Copy, day: string) => new Intl.DateTimeFormat(copy.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(at(day));

/** "Samstag, 24. Oktober" */
export const longDay = (copy: Copy, day: string) => new Intl.DateTimeFormat(copy.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at(day));

/** "12. März" */
export const dayMonth = (copy: Copy, day: string) => new Intl.DateTimeFormat(copy.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(at(day));

/** How long ago, from a number of days: heute, gestern, vor 5 Tagen, vor 3 Wochen, vor 4 Monaten. */
export function ago(copy: Copy, days: number): string {
  if (days <= 0) return copy.seenToday;
  if (days === 1) return copy.seenYesterday;
  if (days < 14) return fill(copy.seenDaysAgo, days);
  if (days < 60) return fill(copy.seenWeeksAgo, Math.round(days / 7));
  return fill(copy.seenMonthsAgo, Math.round(days / 30));
}

/** "alle 4 Wochen" for whole weeks, else "alle 10 Tage". */
export const every = (copy: Copy, days: number) => (days % 7 === 0 && days >= 14 ? fill(copy.everyWeeks, days / 7) : fill(copy.everyDays, days));
