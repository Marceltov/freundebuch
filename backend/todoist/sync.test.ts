import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { recordConversation, remember } from "../conversations/conversations";
import { putSettings } from "../core/settings";
import { firstBook } from "../db/testing";
import { instance } from "../db/scope";
import { linkPeople } from "../people/links";
import { openFollowUps } from "../reading/followups";
import { seed, seedWorkBook, type Seed } from "../testing/fixtures";
import { DEFAULT_KINDS, type Kinds } from "./settings";
import { pullNow, syncAll, syncUser } from "./sync";

// An in-memory Todoist behind fetchFn, one account per token. The sync endpoint answers with the tasks changed since the token.
type Task = { id: string; content: string; description: string; due: string; deadline?: string; checked: boolean; deleted: boolean; changed: number };
type Account = { tasks: Map<string, Task>; refuse?: boolean; failCreate?: number; badRequest?: string };
let accounts: Map<string, Account>;
let clock: number;
let ids: number;
const account = (token: string) => {
  if (!accounts.has(token)) accounts.set(token, { tasks: new Map() });
  return accounts.get(token)!;
};
const fetchFn = (async (url: string, init: RequestInit) => {
  const token = (init.headers as Record<string, string>).Authorization.replace("Bearer ", "");
  const acc = account(token);
  if (acc.refuse) return new Response(null, { status: 401 });
  const path = new URL(url).pathname.replace("/api/v1", "");
  if (path === "/tasks") {
    if (acc.failCreate) {
      acc.failCreate--;
      return new Response(null, { status: 500 });
    }
    const b = JSON.parse(init.body as string);
    if (acc.badRequest && b.content.includes(acc.badRequest)) return new Response(null, { status: 400 });
    const id = `t${++ids}`;
    acc.tasks.set(id, {
      id,
      content: b.content,
      description: b.description,
      due: b.due_date,
      deadline: b.deadline_date,
      checked: false,
      deleted: false,
      changed: ++clock,
    });
    return Response.json({ id });
  }
  const close = path.match(/^\/tasks\/(.+)\/close$/);
  if (close) {
    const t = acc.tasks.get(decodeURIComponent(close[1]));
    if (!t) return new Response(null, { status: 404 });
    Object.assign(t, { checked: true, changed: ++clock });
    return new Response(null, { status: 204 });
  }
  if (path === "/user") return Response.json({ id: `u-${token}` });
  if (path === "/sync") {
    const since = new URLSearchParams(init.body as string).get("sync_token");
    const after = since === "*" ? 0 : Number(since);
    const items = [...acc.tasks.values()].filter((t) => t.changed > after).map((t) => ({ id: t.id, checked: t.checked, is_deleted: t.deleted }));
    return Response.json({ sync_token: String(clock), items });
  }
  return new Response(null, { status: 404 });
}) as unknown as typeof fetch;

const tasks = (token = "ta") => [...account(token).tasks.values()];
const change = (token: string, id: string, c: Partial<Task>) => Object.assign(account(token).tasks.get(id)!, c, { changed: ++clock });

let s: Seed;
// 23 Oct 2026, 08:30 in Europe/Berlin: Tom's birthday (24 Oct, A's private date) is tomorrow.
const NOW = Date.parse("2026-10-23T06:30:00Z");
const DAY = 24 * 3600_000;

async function connect(userId: string, token: string, kinds: Partial<Kinds> = {}) {
  await (
    await instance()
  )
    .insert("todoist_connections", {
      user_id: userId,
      token,
      project_id: "p1",
      project_name: "Freunde",
      kinds: JSON.stringify({ ...DEFAULT_KINDS, ...kinds }),
      broken: 0,
      created_at: 1,
    })
    .execute();
}

const rows = async (userId: string) => (await instance()).from("todoist_tasks").selectAll().where("user_id", "=", userId).orderBy("key").execute();

async function promise(id: string, text: string, due: string, recordedBy: string, visibility = "shared") {
  await (
    await firstBook()
  )
    .insert("promises", { id, person_id: s.anna, text, due, by_me: 1, done: 0, visibility, recorded_by: recordedBy, conversation_id: null, created_at: 1 })
    .execute();
}

async function annaOverdue(userId: string) {
  await (await firstBook()).insert("person_settings", { user_id: userId, person_id: s.anna, interval_days: 1, interval_confirmed: 1 }).execute();
}

beforeEach(async () => {
  vi.stubEnv("TZ", "Europe/Berlin");
  vi.stubEnv("PUBLIC_URL", "https://f.example");
  s = await seed();
  accounts = new Map();
  clock = 0;
  ids = 0;
  await connect(s.a.userId, "ta");
  await putSettings(s.a, { webhookUrl: null, delivery: "todoist" });
});
afterEach(() => vi.unstubAllEnvs());

describe("syncUser", () => {
  test("birthday with lead 1 is created the day before, due on the day", async () => {
    await syncUser(s.a.userId, NOW - DAY, fetchFn);
    expect(tasks().filter((t) => t.content.includes("Tom"))).toEqual([]);
    await syncUser(s.a.userId, NOW, fetchFn);
    const tom = tasks().filter((t) => t.content.includes("Tom"));
    expect(tom).toHaveLength(1);
    expect(tom[0]).toMatchObject({ content: "🎂 Tom hat am 24.10. Geburtstag", description: `https://f.example/p/${s.tom}`, due: "2026-10-24" });
    expect(tom[0].deadline).toBeUndefined();
    expect((await rows(s.a.userId)).find((r) => r.kind === "date")).toMatchObject({ state: "open", person_id: s.tom, day: "2026-10-24" });
  });

  test("with placement deadline: due today, deadline on the day", async () => {
    await (
      await instance()
    )
      .update("todoist_connections")
      .set({ kinds: JSON.stringify({ ...DEFAULT_KINDS, birthday: { leadDays: 7, placement: "deadline" } }) })
      .execute();
    await syncUser(s.a.userId, NOW - 5 * DAY, fetchFn);
    expect(tasks().find((t) => t.content.includes("Tom"))).toMatchObject({ due: "2026-10-18", deadline: "2026-10-24" });
  });

  test("second sync creates nothing new", async () => {
    await annaOverdue(s.a.userId);
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const first = tasks().length;
    expect(first).toBeGreaterThanOrEqual(3);
    await syncUser(s.a.userId, NOW + 60_000, fetchFn);
    await syncUser(s.a.userId, NOW + DAY, fetchFn);
    expect(tasks()).toHaveLength(first);
  });

  test("ticking a promise marks it done", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content === "📌 Versprochen: Buch leihen")!;
    expect(t.due).toBe("2026-10-23");
    change("ta", t.id, { checked: true });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    const p = await (await firstBook()).from("promises").select("done").where("id", "=", "pr1").executeTakeFirstOrThrow();
    expect(p.done).toBe(1);
    expect((await rows(s.a.userId)).find((r) => r.kind === "promise")?.state).toBe("ticked");
    expect(tasks().filter((x) => x.content.includes("Buch leihen"))).toHaveLength(1);
  });

  test("ticking overdue Anna opens a follow-up and Anna is not wanted any more", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content === "⏳ Lange nicht gesehen: Anna")!;
    expect(t.due).toBe("2026-10-23");
    change("ta", t.id, { checked: true });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(await openFollowUps(s.a)).toMatchObject([{ kind: "overdue", personId: s.anna, day: "2026-10-23" }]);
    // made from the last seen in the task's key: the dinner of 20 Oct
    expect(await (await firstBook()).from("follow_ups").select("last_seen").executeTakeFirstOrThrow()).toEqual({ last_seen: "2026-10-20" });
    await syncUser(s.a.userId, NOW + DAY, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Anna"))).toHaveLength(1);
    expect(await openFollowUps(s.b)).toEqual([]);
  });

  test("filing a conversation with Anna closes her overdue task in Todoist", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Anna"))!;
    await recordConversation(s.a, {
      date: "2026-10-23",
      kind: "call",
      summary: "Called Anna.",
      transcript: "Called Anna.",
      visibility: "shared",
      people: [{ id: s.anna, present: true }],
    });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(account("ta").tasks.get(t.id)?.checked).toBe(true);
    expect((await rows(s.a.userId)).find((r) => r.kind === "overdue")?.state).toBe("closed");
    expect(await openFollowUps(s.a)).toEqual([]);
  });

  test("a deleted task is not recreated", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    change("ta", t.id, { deleted: true });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    await syncUser(s.a.userId, NOW + DAY, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Buch leihen"))).toHaveLength(1);
    expect((await rows(s.a.userId)).find((r) => r.kind === "promise")?.state).toBe("gone");
    const p = await (await firstBook()).from("promises").select("done").where("id", "=", "pr1").executeTakeFirstOrThrow();
    expect(p.done).toBe(0);
  });

  test("the partner's private promise never becomes a task for the other user", async () => {
    await connect(s.b.userId, "tb");
    await putSettings(s.b, { webhookUrl: null, delivery: "both" });
    await promise("pb", "Bobs Geheimnis", "2026-10-23", s.b.userId, "private");
    await (
      await firstBook()
    )
      .insert("facts", {
        id: "f1",
        person_id: s.anna,
        text: "Bobs private Sorge",
        category: "other",
        kind: "situation",
        check_after: "2026-10-20",
        visibility: "private",
        recorded_by: s.b.userId,
        conversation_id: null,
        created_at: 1,
      })
      .execute();
    await syncAll(NOW, fetchFn);
    expect(JSON.stringify(tasks("ta"))).not.toContain("Bobs");
    const itemIds = (await rows(s.a.userId)).map((r) => r.item_id);
    expect(itemIds).not.toContain("pb");
    expect(itemIds).not.toContain("f1");
    expect(tasks("tb").map((t) => t.content)).toEqual(
      expect.arrayContaining(["📌 Versprochen: Bobs Geheimnis", "💬 Frag mal nach: Anna – Bobs private Sorge"]),
    );
    // and A's private birthday of Tom never reaches B
    expect(JSON.stringify(tasks("tb"))).not.toContain("Tom");
  });

  test("a linked person in two books gets one task", async () => {
    const w = await seedWorkBook(s);
    await linkPeople(w.a, [s.lena, w.lena2]);
    await remember(s.a, { visibility: "shared", dates: [{ person: s.lena, kind: "birthday", date: "--10-24", yearly: true }] });
    await remember(w.work, { visibility: "shared", dates: [{ person: w.lena2, kind: "birthday", date: "--10-24", yearly: true }] });
    await syncUser(s.a.userId, NOW, fetchFn);
    expect(tasks().filter((t) => t.content.includes("Lena"))).toHaveLength(1);
  });

  test("ticked then unticked before the sync: the follow-up made stays, no second one", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Anna"))!;
    change("ta", t.id, { checked: true });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    change("ta", t.id, { checked: false });
    await syncUser(s.a.userId, NOW + 600_000, fetchFn);
    change("ta", t.id, { checked: true });
    await syncUser(s.a.userId, NOW + 900_000, fetchFn);
    const all = await (await firstBook()).from("follow_ups").selectAll().execute();
    expect(all).toHaveLength(1);
    expect(tasks().filter((x) => x.content.includes("Anna"))).toHaveLength(1);
  });

  test("500 during create leaves no row, the next sync creates it once", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    account("ta").failCreate = 99;
    await expect(syncUser(s.a.userId, NOW, fetchFn)).rejects.toThrow();
    expect(await rows(s.a.userId)).toEqual([]);
    account("ta").failCreate = 0;
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    await syncUser(s.a.userId, NOW + 600_000, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Buch leihen"))).toHaveLength(1);
  });

  test("a 400 on one create leaves the other creates and the closing pass to run", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const anna = tasks().find((x) => x.content.includes("Anna"))!;
    await recordConversation(s.a, {
      date: "2026-10-23",
      kind: "call",
      summary: "Called Anna.",
      transcript: "Called Anna.",
      visibility: "shared",
      people: [{ id: s.anna, present: true }],
    });
    await promise("pr1", "Kaputt", "2026-10-23", s.a.userId);
    await promise("pr2", "Buch leihen", "2026-10-23", s.a.userId);
    account("ta").badRequest = "Kaputt";
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Buch leihen"))).toHaveLength(1);
    expect(tasks().filter((x) => x.content.includes("Kaputt"))).toEqual([]);
    expect(account("ta").tasks.get(anna.id)?.checked).toBe(true);
    expect((await rows(s.a.userId)).find((r) => r.kind === "overdue")?.state).toBe("closed");
    expect((await rows(s.a.userId)).map((r) => r.item_id)).not.toContain("pr1");
    // Once Todoist takes it, the next run makes it.
    account("ta").badRequest = undefined;
    await syncUser(s.a.userId, NOW + 600_000, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Kaputt"))).toHaveLength(1);
  });

  test("a task gone from Todoist (404 on close) is set gone, and the sync goes on", async () => {
    await annaOverdue(s.a.userId);
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const anna = tasks().find((x) => x.content.includes("Anna"))!;
    const book = tasks().find((x) => x.content.includes("Buch leihen"))!;
    account("ta").tasks.delete(anna.id); // gone without a trace in the sync
    await recordConversation(s.a, {
      date: "2026-10-23",
      kind: "call",
      summary: "Called Anna.",
      transcript: "Called Anna.",
      visibility: "shared",
      people: [{ id: s.anna, present: true }],
    });
    await (await firstBook()).update("promises").set({ done: 1 }).where("id", "=", "pr1").execute();
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect((await rows(s.a.userId)).find((r) => r.kind === "overdue")?.state).toBe("gone");
    expect((await rows(s.a.userId)).find((r) => r.kind === "promise")?.state).toBe("closed");
    expect(account("ta").tasks.get(book.id)?.checked).toBe(true);
  });

  test("a task whose person was deleted is closed without reading them", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    await (await firstBook()).delete("persons").where("id", "=", s.anna).execute();
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(account("ta").tasks.get(t.id)?.checked).toBe(true);
    expect((await rows(s.a.userId)).find((r) => r.kind === "promise")?.state).toBe("closed");
  });

  test("a tick on a task whose person was deleted meanwhile is taken, and the sync goes on", async () => {
    await annaOverdue(s.a.userId);
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    for (const t of tasks().filter((x) => !x.content.includes("Tom"))) change("ta", t.id, { checked: true });
    await (await firstBook()).delete("persons").where("id", "=", s.anna).execute();
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect((await rows(s.a.userId)).filter((r) => r.person_id === s.anna).map((r) => r.state)).toEqual(["ticked", "ticked"]);
    expect(await (await firstBook()).from("follow_ups").selectAll().execute()).toEqual([]);
  });

  test("a birthday task whose person was deleted is closed; one whose date still stands stays open", async () => {
    await syncUser(s.a.userId, NOW, fetchFn);
    const tom = tasks().find((x) => x.content.includes("Tom"))!;
    await syncUser(s.a.userId, NOW + 3 * DAY, fetchFn); // the birthday has passed: still open, only a tick closes it
    expect(account("ta").tasks.get(tom.id)?.checked).toBe(false);
    await (await firstBook()).delete("persons").where("id", "=", s.tom).execute();
    await syncUser(s.a.userId, NOW + 3 * DAY + 300_000, fetchFn);
    expect(account("ta").tasks.get(tom.id)?.checked).toBe(true);
    expect((await rows(s.a.userId)).find((r) => r.kind === "date")?.state).toBe("closed");
  });

  test("lowering a lead time keeps the task open and makes no second one", async () => {
    await (
      await instance()
    )
      .update("todoist_connections")
      .set({ kinds: JSON.stringify({ ...DEFAULT_KINDS, promise: { leadDays: 7, placement: "due" } }) })
      .execute();
    await promise("pr1", "Buch leihen", "2026-10-28", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    await (
      await instance()
    )
      .update("todoist_connections")
      .set({ kinds: JSON.stringify(DEFAULT_KINDS) })
      .execute();
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(account("ta").tasks.get(t.id)?.checked).toBe(false);
    await syncUser(s.a.userId, NOW + 5 * DAY, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Buch leihen"))).toHaveLength(1);
    expect((await rows(s.a.userId)).find((r) => r.kind === "promise")?.state).toBe("open");
  });

  test("the same pulled tick applied twice at once makes one follow-up", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    change("ta", tasks().find((x) => x.content.includes("Anna"))!.id, { checked: true });
    await Promise.all([pullNow(s.a, fetchFn), pullNow(s.a, fetchFn), syncUser(s.a.userId, NOW + 300_000, fetchFn)]);
    expect(await (await firstBook()).from("follow_ups").selectAll().execute()).toHaveLength(1);
  });

  test("delivery push makes no new tasks, but ticks still come back", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    await putSettings(s.a, { webhookUrl: null, delivery: "push" });
    await annaOverdue(s.a.userId);
    change("ta", t.id, { checked: true });
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(tasks().filter((x) => x.content.includes("Anna"))).toEqual([]);
    expect((await rows(s.a.userId)).find((r) => r.task_id === t.id)?.state).toBe("ticked");
  });

  test("delivery push with no open task doesn't work out what is due; with one it still closes it", async () => {
    const across = await import("../reading/across");
    const spy = vi.spyOn(across, "dueAcross");
    await putSettings(s.a, { webhookUrl: null, delivery: "push" });
    await syncUser(s.a.userId, NOW, fetchFn);
    expect(spy).not.toHaveBeenCalled();
    await putSettings(s.a, { webhookUrl: null, delivery: "todoist" });
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    await putSettings(s.a, { webhookUrl: null, delivery: "push" });
    await (await firstBook()).update("promises").set({ done: 1 }).where("id", "=", "pr1").execute();
    spy.mockClear();
    await syncUser(s.a.userId, NOW + 300_000, fetchFn);
    expect(spy).toHaveBeenCalled();
    expect(account("ta").tasks.get(t.id)?.checked).toBe(true);
    spy.mockRestore();
  });
});

describe("syncAll", () => {
  test("401 marks the connection broken and the next syncAll skips that user; the other user still syncs", async () => {
    await connect(s.b.userId, "tb");
    await putSettings(s.b, { webhookUrl: null, delivery: "todoist" });
    await promise("pb", "Anruf", "2026-10-23", s.b.userId);
    account("ta").refuse = true;
    let calls = 0;
    const counting = (async (url: string, init: RequestInit) => {
      if ((init.headers as Record<string, string>).Authorization === "Bearer ta") calls++;
      return fetchFn(url, init);
    }) as unknown as typeof fetch;
    await syncAll(NOW, counting);
    const conn = await (await instance()).from("todoist_connections").select("broken").where("user_id", "=", s.a.userId).executeTakeFirstOrThrow();
    expect(conn.broken).toBe(1);
    expect(tasks("tb").map((t) => t.content)).toContain("📌 Versprochen: Anruf");
    const before = calls;
    await syncAll(NOW + 300_000, counting);
    expect(calls).toBe(before);
  });

  test("a connection without a project is skipped", async () => {
    await (await instance()).update("todoist_connections").set({ project_id: null }).execute();
    await syncAll(NOW, fetchFn);
    expect(tasks()).toEqual([]);
  });

  test("the sync position is saved only after the ticks are applied", async () => {
    await promise("pr1", "Buch leihen", "2026-10-23", s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    const t = tasks().find((x) => x.content.includes("Buch leihen"))!;
    change("ta", t.id, { checked: true });
    const corrections = await import("../conversations/corrections");
    const spy = vi.spyOn(corrections, "markDone").mockRejectedValueOnce(new Error("boom"));
    await syncAll(NOW + 300_000, fetchFn);
    spy.mockRestore();
    const state = async () => (await rows(s.a.userId)).find((r) => r.kind === "promise")?.state;
    expect(await state()).toBe("open");
    await syncAll(NOW + 600_000, fetchFn);
    expect(await state()).toBe("ticked");
  });
});

describe("pullNow", () => {
  test("brings ticks in and swallows errors", async () => {
    await annaOverdue(s.a.userId);
    await syncUser(s.a.userId, NOW, fetchFn);
    change("ta", tasks().find((x) => x.content.includes("Anna"))!.id, { checked: true });
    await pullNow(s.a, fetchFn);
    expect(await openFollowUps(s.a)).toHaveLength(1);
    account("ta").refuse = true;
    await expect(pullNow(s.a, fetchFn)).resolves.toBeUndefined();
    await expect(pullNow(s.b, fetchFn)).resolves.toBeUndefined();
  });
});
