import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { bookActions, Books, memberActions, type BookRow } from "./Books";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const book = (role: BookRow["role"], over: Partial<BookRow> = {}): BookRow => ({
  id: "b1",
  name: "Unser Buch",
  role,
  members: [
    { id: "o", name: "Olga", role: "owner" },
    { id: "a", name: "Ada", role: "admin" },
    { id: "m", name: "Mo", role: "member" },
  ],
  ...over,
});

test("a member sees leave but no invite, rename or remove", () => {
  expect(bookActions(book("member"), 2)).toEqual({ rename: false, invite: false, inviteAdmin: false, leave: true, delete: false });
  expect(memberActions(book("member"), "m", { id: "a", name: "Ada", role: "admin" })).toEqual({ remove: false, role: false, handOver: false });
});

test("an admin invites members but not admins, and can't remove the owner", () => {
  expect(bookActions(book("admin"), 2)).toEqual({ rename: true, invite: true, inviteAdmin: false, leave: true, delete: false });
  expect(memberActions(book("admin"), "a", { id: "o", name: "Olga", role: "owner" }).remove).toBe(false);
  expect(memberActions(book("admin"), "a", { id: "m", name: "Mo", role: "member" }).remove).toBe(true);
  expect(memberActions(book("admin"), "a", { id: "m", name: "Mo", role: "member" }).role).toBe(false);
});

test("the owner sees hand over and delete; no leave", () => {
  expect(bookActions(book("owner"), 2)).toEqual({ rename: true, invite: true, inviteAdmin: true, leave: false, delete: true });
  expect(bookActions(book("owner"), 1).delete).toBe(false);
  expect(memberActions(book("owner"), "o", { id: "a", name: "Ada", role: "admin" })).toEqual({ remove: true, role: true, handOver: true });
  expect(memberActions(book("owner"), "o", { id: "o", name: "Olga", role: "owner" })).toEqual({ remove: false, role: false, handOver: false });
});

test("no leave on the only book", () => {
  expect(bookActions(book("member"), 1).leave).toBe(false);
});

test("the section shows each book with its members and the buttons the role allows", () => {
  const html = renderToStaticMarkup(
    <Books books={[book("owner", { id: "b1" }), book("member", { id: "b2", name: "Verein" })]} invitations={{ b1: [] }} me="o" />,
  );
  const card = (name: string) => html.slice(html.indexOf(`aria-label="${name}"`), html.indexOf("</section>", html.indexOf(`aria-label="${name}"`)));
  expect(card("Unser Buch")).toContain("Buch löschen");
  expect(card("Unser Buch")).not.toContain(">Verlassen<");
  expect(card("Verein")).toContain(">Verlassen<");
  expect(card("Verein")).not.toContain("Einladen");
  expect(card("Unser Buch")).toContain("Besitzer");
});
