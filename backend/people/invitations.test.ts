import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { instance } from "../db/scope";
import { ForbiddenError, InvalidInputError, NotFoundError } from "../core/errors";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { INVITATION_DAYS, acceptInvitation, invitationFor, invite, listInvitations, revokeInvitation } from "./invitations";
import { listBooks } from "./books";
import { viewerById } from "../core/users";

let s: Seed;

beforeEach(async () => {
  s = await seed();
});
afterEach(() => vi.useRealTimers());

const newUser = async (id: string, name: string) => {
  await (await instance()).insert("users", { id, oidc_sub: id, name, email: null, created_at: Date.now() }).execute();
};
const tokenOf = (url: string) => url.split("/").pop()!;

test("an invitation works once and makes the role it names", async () => {
  const inv = await invite(s.a, "admin");
  expect(inv.url).toMatch(/^\/einladung\/fbi_/);
  const token = tokenOf(inv.url);
  expect(await invitationFor(token)).toMatchObject({ bookId: s.a.bookId, bookName: "Unser Buch", role: "admin", by: "Alice" });
  await newUser("carol", "Carol");
  const c = await acceptInvitation(await instance(), token, "carol", "Carol");
  expect(c.bookId).toBe(s.a.bookId);
  expect((await listBooks(c)).map((b) => [b.name, b.role])).toEqual([["Unser Buch", "admin"]]);
  await newUser("dave", "Dave");
  await expect(acceptInvitation(await instance(), token, "dave", "Dave")).rejects.toBeInstanceOf(NotFoundError);
  expect(await invitationFor(token)).toBeNull();
});

test("an expired or revoked invitation lets no one in", async () => {
  const expired = await invite(s.a, "member");
  const revoked = await invite(s.a, "member");
  expect((await listInvitations(s.a)).map((i) => i.id).sort()).toEqual([expired.id, revoked.id].sort());
  await revokeInvitation(s.a, revoked.id);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + INVITATION_DAYS * 86_400_000 + 1000);
  await newUser("carol", "Carol");
  for (const i of [expired, revoked]) {
    expect(await invitationFor(tokenOf(i.url))).toBeNull();
    await expect(acceptInvitation(await instance(), tokenOf(i.url), "carol", "Carol")).rejects.toBeInstanceOf(NotFoundError);
  }
  expect(await listInvitations(s.a)).toEqual([]);
});

test("a member can't invite; an admin and the owner can", async () => {
  await (await instance()).update("members").set({ role: "member" }).where("user_id", "=", s.b.userId).execute();
  await expect(invite(s.b, "member")).rejects.toBeInstanceOf(ForbiddenError);
  await (await instance()).update("members").set({ role: "admin" }).where("user_id", "=", s.b.userId).execute();
  await expect(invite(s.b, "member")).resolves.toMatchObject({ url: expect.any(String) });
  await expect(revokeInvitation(s.b, "nope")).rejects.toBeInstanceOf(NotFoundError);
});

test("only the owner invites admins", async () => {
  await expect(invite(s.b, "admin")).rejects.toBeInstanceOf(ForbiddenError);
  await expect(invite(s.a, "admin")).resolves.toMatchObject({ url: expect.any(String) });
});

test("an existing user joins a second book through it, once", async () => {
  const w = await seedWorkBook(s);
  const inv = await invite(w.work, "member");
  const b = await acceptInvitation(await instance(), tokenOf(inv.url), s.b.userId, "Bob");
  expect(b.bookId).toBe(w.work.bookId);
  expect((await viewerById(s.b.userId))!.books).toHaveLength(2);
  const again = await invite(w.work, "member");
  await expect(acceptInvitation(await instance(), tokenOf(again.url), s.b.userId, "Bob")).rejects.toBeInstanceOf(InvalidInputError);
  expect(await invitationFor(tokenOf(again.url))).not.toBeNull();
});
