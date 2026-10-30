import { beforeEach, expect, test } from "vitest";
import { db } from "./db/testing";
import { InvalidInputError, NotFoundError } from "./errors";
import { checkLook, looks, parseLook, setLook } from "./looks";
import { getPerson } from "./people";
import { remember } from "./conversations";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});

const parts = { face: "long", skin: "brown", hair: "afro", hairColor: "black", glasses: "square", beard: "stubble" } as const;

test("a look needs every part, each one of its values, and nothing else", () => {
  expect(checkLook({ ...parts, description: "  Afro, eckige Brille " })).toEqual({ ...parts, description: "Afro, eckige Brille" });
  expect(checkLook(parts)).toEqual({ ...parts, description: null });
  expect(() => checkLook({ ...parts, hair: "mohawk" })).toThrow(/hair must be one of none, buzz/);
  expect(() => checkLook({ ...parts, glasses: undefined })).toThrow(InvalidInputError);
  expect(() => checkLook({ ...parts, hat: "cap" })).toThrow(/no part "hat"/);
  expect(() => checkLook({ ...parts, description: "x".repeat(501) })).toThrow(/at most 500/);
  expect(() => checkLook("curly")).toThrow(InvalidInputError);
});

test("a stored look that no longer fits the parts shows as none, so the initials come back", () => {
  expect(parseLook(null)).toBeNull();
  expect(parseLook(JSON.stringify({ ...parts, hair: "dreadlocks" }))).toBeNull();
  expect(parseLook(JSON.stringify(parts))).toEqual({ ...parts, description: null });
});

test("a look is shared like the name: either user sets it, both see it", async () => {
  await setLook(s.a, s.anna, { ...parts, description: "Afro" });
  expect((await getPerson(s.b, s.anna)).look).toEqual({ ...parts, description: "Afro" });
  expect(await looks(s.b)).toEqual({ [s.anna]: parts });
  await setLook(s.b, s.anna, null);
  expect((await getPerson(s.a, s.anna)).look).toBeNull();
  expect(await looks(s.a)).toEqual({});
  await expect(setLook(s.a, "nobody", parts)).rejects.toThrow(NotFoundError);
});

test("remember sets looks with the rest and checks them before writing anything", async () => {
  await expect(
    remember(s.a, {
      visibility: "shared",
      facts: [{ person: s.lena, text: "mag Jazz", category: "other" }],
      looks: [{ person: s.lena, look: { ...parts, skin: "green" } }],
    }),
  ).rejects.toThrow(InvalidInputError);
  expect(await (await db()).selectFrom("facts").select("id").where("text", "=", "mag Jazz").execute()).toEqual([]);
  const r = await remember(s.a, { visibility: "shared", looks: [{ person: s.lena, look: parts }] });
  expect(r.counts.looks).toBe(1);
  expect((await getPerson(s.b, s.lena)).look).toMatchObject(parts);
});
