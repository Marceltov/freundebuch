// Name matching: everything is compared in its `norm` form, so "Jürgen", "Juergen" and "JÜRGEN " are one name.
const FOLDS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => FOLDS[c])
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the edit distance between `a` and `b` is at most `max`. */
export function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}
