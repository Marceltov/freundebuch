// Birthday messages the user sends themself (ADR 0023). freundebuch never sends one: Claude drafts it from what the user may see,
// the user reads and changes it, and sends it from their own messenger through a link that only fills the text in (V3).
// What the draft may draw on is narrower than a briefing: the message goes to the person, so only what is shared in the book
// about them and nothing about their health, needs or temperament, which is for planning around them, not for saying to them.
import { briefing } from "./briefing";
import { InvalidInputError } from "./errors";
import { daysBetween, today } from "./dates";
import type { Viewer } from "./types";

export const SEND_APPS = ["whatsapp", "telegram", "sms", "email"] as const;
export type SendApp = (typeof SEND_APPS)[number];
/** A link that opens `app` with the message filled in; the user picks who it goes to and sends it there. */
export type SendLink = { app: SendApp; url: string };

/**
 * What a birthday message can be written from. `birthday`: when it is next (`inDays` from today) and the age then, when the year
 * is known; null when none is filed. `roles`: who the person is to the household. `news` and `known`: what is going on and what
 * stays true, only shared items and nothing about health. `lastSeen`: the day the viewer last spoke to them.
 */
export type BirthdayMessage = {
  person: { id: string; name: string; url: string };
  birthday: { date: string; inDays: number; age: number | null } | null;
  roles: string[];
  news: string[];
  known: string[];
  lastSeen: string | null;
  /** With a final text: the links to send it with. Empty while drafting. */
  send: SendLink[];
};

const MAX_TEXT = 2000;

/** Links that open each app with `text` filled in and no one chosen yet. */
export function sendLinks(text: string): SendLink[] {
  const t = encodeURIComponent(text);
  return [
    { app: "whatsapp", url: `https://wa.me/?text=${t}` },
    { app: "telegram", url: `https://t.me/share/url?url=%20&text=${t}` },
    { app: "sms", url: `sms:?&body=${t}` },
    { app: "email", url: `mailto:?body=${t}` },
  ];
}

/** What a birthday message to `personId` can be written from; with `text`, the message to send, also the links to send it with. */
export async function birthdayMessage(v: Viewer, personId: string, text?: string, from = today()): Promise<BirthdayMessage> {
  const message = text?.trim();
  if (text !== undefined && !message) throw new InvalidInputError("text is empty: leave it out while drafting");
  if (message && message.length > MAX_TEXT) throw new InvalidInputError(`text is longer than ${MAX_TEXT} characters`);
  const b = await briefing(v, personId, from);
  const sayable = (f: { visibility: string; category: string }) => f.visibility === "shared" && f.category !== "health";
  const bd = b.person.birthday;
  return {
    person: { id: b.person.id, name: b.person.name, url: b.person.url },
    birthday: bd ? { date: bd.next, inDays: daysBetween(from, bd.next), age: bd.age } : null,
    roles: b.roles.map((r) => r.label),
    news: b.situations.filter(sayable).map((f) => f.text),
    known: b.known.filter(sayable).map((f) => f.text),
    lastSeen: b.freshness.lastSeen,
    send: message ? sendLinks(message) : [],
  };
}
