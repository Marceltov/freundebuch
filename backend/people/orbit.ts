// The start page's orbit: the viewer in the middle, people on three rings by how fresh the viewer's own contact with them is.
// Placement reads `freshness` (the viewer's own last seen and interval), and badges read only what the viewer may see, so the
// partner's private conversations never move a face and their private items never badge one.
import { scope } from "../db/scope";
import { daysBetween, today } from "./dates";
import { upcomingDates } from "../reading/due";
import { freshness } from "./intervals";
import type { Viewer } from "../core/types";
import { personPath } from "../core/urls";
import { getGroup } from "./groups";
import { visible } from "../visibility";

const MAX_FACES = 24;
const SOON_DAYS = 14;
const RECENT_DAYS = 14;
const NEAR_DAYS = 45;
const NEARLY_DUE = 0.75;
// Each ring starts at its own angle (0 is the top), so faces on neighbouring rings don't line up.
const RING_OFFSET = [0, 40, 20] as const;

export type Badge = "birthday" | "promise" | "gift";
/** `inGroup`: only with a group filter, whether the person is in that group. `unseen`: the viewer never met them; they fill free
 * places on the outer ring, so someone new to the book sees its people at once. */
export type OrbitFace = { personId: string; name: string; ring: 0 | 1 | 2; angle: number; badges: Badge[]; url: string; inGroup?: boolean; unseen?: boolean };

// FNV-1a: a stable order within a ring that doesn't follow names or ids alphabetically.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Ring 0 below half the interval, 1 below all of it, 2 from then on; without an interval 14 and 45 days since last seen. */
function ringOf(ratio: number | null, intervalDays: number | null, daysSince: number | null): 0 | 1 | 2 {
  if (intervalDays !== null) return ratio === null ? 2 : ratio < 0.5 ? 0 : ratio < 1 ? 1 : 2;
  if (daysSince === null) return 2;
  return daysSince <= RECENT_DAYS ? 0 : daysSince <= NEAR_DAYS ? 1 : 2;
}

/**
 * The faces worth showing, most urgent first, at most 24: overdue or nearly so (ratio ≥ 0.75), seen within 14 days, a birthday
 * within 14 days, or an open promise. Urgency is the largest of the ratio, 1 for an open promise, and 1–2 for a birthday (the
 * sooner the higher); a face that is only recent has 0. `angle` is in degrees, spread evenly within each ring. With `groupId`, the
 * group's members the viewer may see are shown whatever their urgency and come first, each face marked `inGroup`.
 */
export async function orbit(v: Viewer, now = Date.now(), groupId?: string): Promise<OrbitFace[]> {
  const from = today(now);
  const d = await scope(v);
  const members = groupId ? new Set((await getGroup(v, groupId)).members.map((m) => m.personId)) : null;
  const [persons, birthdays, promised, gifts] = await Promise.all([
    d.from("persons").select(["id", "name"]).where("id", "!=", v.personId).execute(),
    upcomingDates(v, from, SOON_DAYS).then((ds) => ds.filter((x) => x.kind === "birthday")),
    d
      .from("promises")
      .select("person_id")
      .where("done", "=", 0)
      .$call((qb) => visible(qb, v, "promises"))
      .execute(),
    d
      .from("exchanges")
      .select("person_id")
      .where("kind", "=", "gift_idea")
      .where("settled", "=", 0)
      .$call((qb) => visible(qb, v, "exchanges"))
      .execute(),
  ]);
  const birthdayIn = new Map(birthdays.map((b) => [b.personId, b.inDays]));
  const withPromise = new Set(promised.map((p) => p.person_id));
  const withGift = new Set(gifts.map((g) => g.person_id));

  const picked: Array<Omit<OrbitFace, "angle" | "url"> & { urgency: number }> = [];
  for (const p of persons) {
    const { lastSeen, intervalDays, ratio } = await freshness(v, p.id, from);
    const daysSince = lastSeen ? daysBetween(lastSeen, from) : null;
    const birthday = birthdayIn.get(p.id);
    const promise = withPromise.has(p.id);
    const relevant = (ratio ?? 0) >= NEARLY_DUE || (daysSince !== null && daysSince <= RECENT_DAYS) || birthday !== undefined || promise;
    const unseen = !relevant && daysSince === null;
    if (!relevant && !unseen && !members?.has(p.id)) continue;
    const badges: Badge[] = [];
    if (birthday !== undefined) badges.push("birthday");
    if (promise) badges.push("promise");
    if (withGift.has(p.id)) badges.push("gift");
    const urgency = unseen ? -1 : Math.max(ratio ?? 0, promise ? 1 : 0, birthday !== undefined ? 1 + (SOON_DAYS - birthday) / SOON_DAYS : 0);
    picked.push({ personId: p.id, name: p.name, ring: ringOf(ratio, intervalDays, daysSince), badges, urgency, ...(unseen ? { unseen } : {}) });
  }
  const first = (f: { personId: string }) => (members?.has(f.personId) ? 1 : 0);
  picked.sort((a, b) => first(b) - first(a) || b.urgency - a.urgency || a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId));
  const shown = picked.slice(0, MAX_FACES);

  const angle = new Map<string, number>();
  for (const ring of [0, 1, 2] as const) {
    const onRing = shown.filter((f) => f.ring === ring).sort((a, b) => hash(a.personId) - hash(b.personId));
    onRing.forEach((f, i) => angle.set(f.personId, (RING_OFFSET[ring] + (i * 360) / onRing.length) % 360));
  }
  return shown.map((f) => ({
    personId: f.personId,
    name: f.name,
    ring: f.ring,
    angle: angle.get(f.personId)!,
    badges: f.badges,
    url: personPath(f.personId),
    ...(f.unseen ? { unseen: true } : {}),
    ...(members ? { inGroup: members.has(f.personId) } : {}),
  }));
}
