import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetDbForTests, unchecked } from "../db/testing";
import { renamePerson } from "../conversations/corrections";
import { findPeople } from "../people/people";
import { signInInvited } from "../testing/fixtures";
import { userFromOidc, viewerById } from "./users";
import { NotInvitedError } from "./errors";
import { invite } from "../people/invitations";

beforeEach(() => resetDbForTests());

test("the same sub gives the same viewer and one person", async () => {
  const a = await userFromOidc({ sub: "s1", name: "Marcel", email: "m@x.de" });
  const b = await userFromOidc({ sub: "s1", name: "Marcel B." });
  expect(b).toEqual(a);
  const d = unchecked();
  expect(await d.selectFrom("users").selectAll().execute()).toHaveLength(1);
  const persons = await d.selectFrom("persons").selectAll().execute();
  expect(persons).toHaveLength(1);
  expect(persons[0].id).toBe(a.personId);
  expect(persons[0].created_by).toBe(a.userId);
  expect(persons[0].name).toBe("Marcel B.");
  expect((await d.selectFrom("users").select("name").executeTakeFirstOrThrow()).name).toBe("Marcel B.");
});

test("different subs give different viewers", async () => {
  const a = await userFromOidc({ sub: "s1", name: "A" });
  const b = await signInInvited(a, { sub: "s2", name: "B" });
  expect(a.userId).not.toBe(b.userId);
  expect(a.personId).not.toBe(b.personId);
});

test("viewerById finds a user and returns null for an unknown id", async () => {
  const a = await userFromOidc({ sub: "s1", name: "A" });
  expect(await viewerById(a.userId)).toEqual(a);
  expect(await viewerById("nope")).toBeNull();
});

test("a person renamed in freundebuch keeps that name when the user signs in again; the sign-in name is kept as another name", async () => {
  const v = await userFromOidc({ sub: "bille", name: "Bille" });
  await renamePerson(v, v.personId, "Sybille");
  await userFromOidc({ sub: "bille", name: "Bille" });
  const d = unchecked();
  expect((await d.selectFrom("persons").select("name").where("id", "=", v.personId).executeTakeFirstOrThrow()).name).toBe("Sybille");
  expect((await d.selectFrom("users").select("name").where("id", "=", v.userId).executeTakeFirstOrThrow()).name).toBe("Bille");
  expect((await findPeople(v, "Bille"))[0]?.id).toBe(v.personId);
});

describe("who gets a book", () => {
  afterEach(() => vi.unstubAllEnvs());
  const books = async () => (await unchecked().selectFrom("books").select("name").orderBy("created_at").execute()).map((b) => b.name);

  test("the first sign-in on a fresh instance gets Unser Buch whatever the setting", async () => {
    vi.stubEnv("FREUNDEBUCH_REGISTRATION", "closed");
    await userFromOidc({ sub: "a", name: "Alice" });
    expect(await books()).toEqual(["Unser Buch"]);
  });

  test("a stranger on a closed instance is turned away, and no user is made", async () => {
    await userFromOidc({ sub: "a", name: "Alice" });
    await expect(userFromOidc({ sub: "x", name: "Xaver" })).rejects.toBeInstanceOf(NotInvitedError);
    expect(await unchecked().selectFrom("users").select("name").where("oidc_sub", "=", "x").execute()).toEqual([]);
  });

  test("open registration gives a stranger an empty book of their own", async () => {
    vi.stubEnv("FREUNDEBUCH_REGISTRATION", "open");
    await userFromOidc({ sub: "a", name: "Alice" });
    const x = await userFromOidc({ sub: "x", name: "Xaver" });
    expect(await books()).toEqual(["Unser Buch", "Mein Buch"]);
    expect(x.books).toHaveLength(1);
  });

  test("an invitation takes a new user into its book", async () => {
    const a = await userFromOidc({ sub: "a", name: "Alice" });
    const { url } = await invite(a, "admin");
    const b = await userFromOidc({ sub: "b", name: "Bob" }, { invitation: url.split("/").pop() });
    expect(b.bookId).toBe(a.bookId);
    expect(await books()).toEqual(["Unser Buch"]);
  });
});
