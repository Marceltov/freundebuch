// Name matching: everything is compared in its `norm` form, so "Jürgen", "Juergen" and "JÜRGEN " are one name.
const FOLDS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function norm(s: string): string {
  return s
    .normalize("NFC") // decomposed "ü" must fold like "ü", before NFKD would strip its diaeresis
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

/** A typo is forgiven only in words this long. */
const FUZZY_MIN = 5;

/**
 * How well the normalised query `q` matches any of `strings`: 0 the same, 1 a word or the whole starts with it, 2 one typo off
 * in a word of FUZZY_MIN letters or more; null no match. Shared by people and places.
 */
export function rank(q: string, strings: string[]): number | null {
  let best: number | null = null;
  const consider = (r: number) => (best = best === null ? r : Math.min(best, r));
  for (const s of strings.map(norm)) {
    if (s === q) return 0;
    const words = s.split(" ");
    if (words.some((w) => w.startsWith(q)) || s.startsWith(q)) consider(1);
    else if (q.length >= FUZZY_MIN && [s, ...words].some((w) => w.length >= FUZZY_MIN && within(q, w, 1))) consider(2);
  }
  return best;
}
