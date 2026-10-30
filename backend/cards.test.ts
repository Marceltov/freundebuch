import { beforeEach, expect, test, vi } from "vitest";
import { briefing } from "./briefing";
import {
  cardPath,
  cardRoute,
  checkCard,
  fetchable,
  ownCard,
  parseVCard,
  personCard,
  publishCard,
  refreshCards,
  setOwnCard,
  subscribeCard,
  toVCard,
  unpublishCard,
  unsubscribeCard,
} from "./cards";
import { seed, type Seed } from "./testing/fixtures";

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const publicDns = async () => ["93.184.216.34"];
const served = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": "text/vcard" } })) as unknown as typeof fetch;

test("a card keeps only what fits, and a birthday as a day with or without the year", () => {
  expect(checkCard({ name: " Anna ", phone: "", birthday: "1986-11-03" })).toEqual({ name: "Anna", birthday: "1986-11-03" });
  expect(checkCard({ birthday: "--1103" })).toEqual({ birthday: "--11-03" });
  expect(() => checkCard({ birthday: "1986-02-30" })).toThrow(/not a day/);
  expect(() => checkCard({ note: "x".repeat(1001) })).toThrow(/longer/);
  expect(() => checkCard({ phone: 5 })).toThrow(/text/);
});

test("a card goes out as a vCard and comes back the same, and one from another app reads too", () => {
  const card = {
    name: "Anna; Reise",
    phone: "+49 170 1234567",
    email: "anna@example.org",
    address: "Hauptstr. 1, Berlin",
    birthday: "--11-03",
    note: "Zeile 1\nZeile 2",
  };
  const vcf = toVCard(card, Date.UTC(2026, 9, 31));
  expect(vcf).toContain("BEGIN:VCARD\r\nVERSION:4.0\r\n");
  expect(vcf).toContain("BDAY:--1103\r\n");
  expect(vcf).toContain("REV:20261031T000000Z\r\n");
  expect(parseVCard(vcf)).toEqual(card);
  // Apple's 3.0, with a group prefix, a folded line and an address in its parts.
  const apple =
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Tom Kr\r\n aus\r\nitem1.TEL;type=CELL:+49 160 1\r\nADR;TYPE=HOME:;;Gartenweg 2;Köln;;50667;\r\nBDAY:1990-04-12\r\nEND:VCARD\r\n";
  expect(parseVCard(apple)).toEqual({ name: "Tom Kraus", phone: "+49 160 1", address: "Gartenweg 2, Köln, 50667", birthday: "1990-04-12" });
  expect(parseVCard("<html>nope</html>")).toBeNull();
});

test("the own card is served behind its link, a new link ends the old one, and unpublishing ends it", async () => {
  await setOwnCard(s.a, { name: "Alice", phone: "+49 1" });
  expect(await ownCard(s.a)).toEqual({ card: { name: "Alice", phone: "+49 1" }, published: false });
  const first = await publishCard(s.a);
  expect(cardPath(first)).toMatch(/^\/api\/card\/fbk_[\w-]+\.vcf$/);
  const res = await cardRoute(`${first}.vcf`);
  expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
  expect(parseVCard(await res.text())).toEqual({ name: "Alice", phone: "+49 1" });
  const second = await publishCard(s.a);
  expect((await cardRoute(`${first}.vcf`)).status).toBe(404);
  expect((await cardRoute(`${second}.vcf`)).status).toBe(200);
  // Changing the card keeps the link.
  await setOwnCard(s.a, { name: "Alice", email: "a@example.org" });
  expect(parseVCard(await (await cardRoute(`${second}.vcf`)).text())).toEqual({ name: "Alice", email: "a@example.org" });
  await unpublishCard(s.a);
  expect((await cardRoute(`${second}.vcf`)).status).toBe(404);
  expect((await cardRoute("nope.vcf")).status).toBe(404);
  // Bob's card is his own.
  expect((await ownCard(s.b)).card).toEqual({});
});

test("a card is fetched only from https on the internet, never from this server or the networks behind it", async () => {
  expect(await fetchable("https://cards.example.org/a.vcf", publicDns)).toBe(true);
  expect(await fetchable("http://cards.example.org/a.vcf", publicDns)).toBe(false);
  expect(await fetchable("https://user:pw@cards.example.org/a.vcf", publicDns)).toBe(false);
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.178.162", "172.20.0.5", "169.254.169.254", "::1", "fd00::1"])
    expect(await fetchable("https://whisper/a.vcf", async () => [ip]), ip).toBe(false);
  expect(await fetchable("https://[::1]/a.vcf", publicDns)).toBe(false);
  // One private address among public ones is enough to refuse.
  expect(await fetchable("https://x.example/a.vcf", async () => ["93.184.216.34", "10.0.0.1"])).toBe(false);
  expect(await fetchable("https://nowhere.invalid/a.vcf", async () => Promise.reject(new Error("ENOTFOUND")))).toBe(false);
  await expect(subscribeCard(s.a, s.anna, "https://whisper/a.vcf", served(""), async () => ["172.20.0.5"])).rejects.toThrow(/https address on the internet/);
});

test("a subscribed card is in the briefing for both users, kept apart from what was told, and refreshed once a day", async () => {
  const vcf = toVCard({ name: "Anna Reise", phone: "+49 170 1", birthday: "1986-11-03" }, Date.now());
  const fetchFn = served(vcf);
  const got = await subscribeCard(s.a, s.anna, "https://cards.example.org/anna.vcf", fetchFn, publicDns);
  expect(got).toMatchObject({ card: { name: "Anna Reise", phone: "+49 170 1" }, failed: null });
  expect(fetchFn).toHaveBeenCalledWith("https://cards.example.org/anna.vcf", expect.objectContaining({ redirect: "manual" }));
  expect((await briefing(s.b, s.anna)).card?.card?.phone).toBe("+49 170 1");
  expect((await briefing(s.a, s.anna)).known.map((f) => f.text)).not.toContain("+49 170 1");
  // Not again within the day; after it, again, and a revoked link shows as not found while the last card stays.
  expect(await refreshCards(Date.now(), fetchFn, publicDns)).toBe(0);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  const gone = served("", 404);
  await refreshCards(Date.now() + 86_400_001, gone, publicDns);
  expect(await personCard(s.anna)).toMatchObject({ card: { phone: "+49 170 1" }, failed: "not_found" });
  // A page that is no card, and an unreachable host.
  expect((await subscribeCard(s.a, s.tom, "https://x.example/tom", served("<html/>"), publicDns)).failed).toBe("not_a_card");
  const down = vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  expect((await subscribeCard(s.a, s.tom, "https://x.example/tom", down, publicDns)).failed).toBe("unreachable");
  await unsubscribeCard(s.anna);
  expect(await personCard(s.anna)).toBeNull();
  expect((await briefing(s.a, s.anna)).card).toBeNull();
});
