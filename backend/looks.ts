// A person's look: the parts their avatar is put together from, and the user's own words for how they look. Shared like the
// name, because it is how the person looks, not something the household knows about them. No picture is kept (V4): the
// parts are drawn on the fly (components/Avatar.tsx), and `description` lets Claude choose them again when the parts change.
import { db } from "./db";
import { InvalidInputError, NotFoundError } from "./errors";
import { LOOK_PART_NAMES, LOOK_PARTS, type Look, type LookParts, type Viewer } from "./types";

const MAX_DESCRIPTION = 500;

/** Checks a look and returns just its parts and description; anything else in it is an error, so a misspelt part is caught. */
export function checkLook(look: unknown): Look {
  if (!look || typeof look !== "object") throw new InvalidInputError("A look needs its parts");
  const l = look as Record<string, unknown>;
  for (const key of Object.keys(l)) if (key !== "description" && !(key in LOOK_PARTS)) throw new InvalidInputError(`A look has no part "${key}"; the parts are ${LOOK_PART_NAMES.join(", ")}`);
  for (const part of LOOK_PART_NAMES) {
    const values: readonly string[] = LOOK_PARTS[part];
    if (!values.includes(l[part] as string)) throw new InvalidInputError(`A look's ${part} must be one of ${values.join(", ")}`);
  }
  const description = l.description === undefined || l.description === null ? null : String(l.description).trim() || null;
  if (description && description.length > MAX_DESCRIPTION) throw new InvalidInputError(`A look's description is at most ${MAX_DESCRIPTION} characters`);
  return { ...(Object.fromEntries(LOOK_PART_NAMES.map((p) => [p, l[p]])) as LookParts), description };
}

/** A stored look, or null when there is none or it no longer fits the parts (then the person shows their initials). */
export function parseLook(json: string | null): Look | null {
  if (!json) return null;
  try {
    return checkLook(JSON.parse(json));
  } catch {
    return null;
  }
}

export const lookJson = (look: Look | null): string | null => (look ? JSON.stringify(look) : null);

/** Sets or (with null) clears a person's look. Shared like the name, so either user may set it. */
export async function setLook(v: Viewer, personId: string, look: unknown): Promise<Look | null> {
  void v;
  const checked = look === null ? null : checkLook(look);
  const d = await db();
  const res = await d.updateTable("persons").set({ look: lookJson(checked) }).where("id", "=", personId).executeTakeFirst();
  if (!res.numUpdatedRows) throw new NotFoundError("No such person");
  return checked;
}

/** The parts of everyone who has a look, by person id: what every page draws a face from. */
export async function looks(v: Viewer): Promise<Record<string, LookParts>> {
  void v;
  const rows = await (await db()).selectFrom("persons").select(["id", "look"]).where("look", "is not", null).execute();
  const out: Record<string, LookParts> = {};
  for (const r of rows) {
    const look = parseLook(r.look);
    if (look) {
      const { description, ...parts } = look;
      void description;
      out[r.id] = parts;
    }
  }
  return out;
}
