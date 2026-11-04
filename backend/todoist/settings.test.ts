import { beforeEach, describe, expect, test } from "vitest";
import { getSettings, putSettings } from "../core/settings";
import { instance } from "../db/scope";
import { seed, type Seed } from "../testing/fixtures";
import { connectTodoist, DEFAULT_KINDS, disconnectTodoist, setTodoistKinds, setTodoistProject, todoistStatus } from "./settings";

const PROJECTS = [
  { id: "p1", name: "Inbox" },
  { id: "p2", name: "Friends" },
];
const fake = (status = 200) => (async () => new Response(JSON.stringify({ results: PROJECTS, next_cursor: null }), { status })) as unknown as typeof fetch;

let s: Seed;
beforeEach(async () => {
  s = await seed();
});

const taskRow = (user_id: string, key: string) => ({
  user_id,
  key,
  task_id: "t1",
  book_id: s.a.bookId,
  kind: "promise" as const,
  item_id: "i1",
  person_id: "x",
  day: "2026-11-04",
  state: "open" as const,
  created_at: 1,
});

describe("todoist settings", () => {
  test("connect stores the token and never returns it", async () => {
    expect(await todoistStatus(s.a)).toEqual({ connected: false });
    expect(await connectTodoist(s.a, "secret-token", fake())).toEqual(PROJECTS);
    await setTodoistProject(s.a, "p2", fake());
    const status = await todoistStatus(s.a);
    expect(status).toEqual({ connected: true, projectId: "p2", projectName: "Friends", broken: false, kinds: DEFAULT_KINDS });
    expect(JSON.stringify(status)).not.toContain("token");
    expect(JSON.stringify(status)).not.toContain("secret-token");
    const row = await (await instance()).from("todoist_connections").selectAll().where("user_id", "=", s.a.userId).executeTakeFirstOrThrow();
    expect(row.token).toBe("secret-token");
    expect(await todoistStatus(s.b)).toEqual({ connected: false });
  });

  test("a refused token is an InvalidInputError and nothing is stored", async () => {
    await expect(connectTodoist(s.a, "bad", fake(401))).rejects.toMatchObject({ code: "invalid_input", message: "the Todoist token was not accepted" });
    expect(await (await instance()).from("todoist_connections").selectAll().execute()).toEqual([]);
  });

  test("an unknown project is refused", async () => {
    await connectTodoist(s.a, "t", fake());
    await expect(setTodoistProject(s.a, "nope", fake())).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setTodoistProject(s.b, "p1", fake())).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("kinds default and merge", async () => {
    expect(DEFAULT_KINDS).toEqual({
      birthday: { leadDays: 1, placement: "due" },
      anniversary: { leadDays: 0, placement: "due" },
      date: { leadDays: 0, placement: "due" },
      promise: { leadDays: 0, placement: "due" },
    });
    await connectTodoist(s.a, "t", fake());
    await setTodoistProject(s.a, "p1", fake());
    await setTodoistKinds(s.a, { birthday: { leadDays: 7, placement: "deadline" } });
    await setTodoistKinds(s.a, { promise: { leadDays: 2, placement: "due" } });
    const status = await todoistStatus(s.a);
    expect(status).toMatchObject({ kinds: { ...DEFAULT_KINDS, birthday: { leadDays: 7, placement: "deadline" }, promise: { leadDays: 2, placement: "due" } } });
  });

  test("leadDays outside 0-60 is rejected", async () => {
    await connectTodoist(s.a, "t", fake());
    for (const leadDays of [-1, 61, 1.5])
      await expect(setTodoistKinds(s.a, { date: { leadDays, placement: "due" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setTodoistKinds(s.a, { date: { leadDays: 1, placement: "nope" as "due" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setTodoistKinds(s.b, { date: { leadDays: 1, placement: "due" } })).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("reconnecting keeps the kinds and forgets the project and the sync position", async () => {
    await connectTodoist(s.a, "t", fake());
    await setTodoistProject(s.a, "p1", fake());
    await setTodoistKinds(s.a, { date: { leadDays: 3, placement: "due" } });
    await (await instance()).update("todoist_connections").set({ broken: 1, sync_token: "st" }).where("user_id", "=", s.a.userId).execute();
    await connectTodoist(s.a, "t2", fake());
    expect(await todoistStatus(s.a)).toEqual({ connected: false });
    await setTodoistProject(s.a, "p1", fake());
    expect(await todoistStatus(s.a)).toMatchObject({ broken: false, kinds: { date: { leadDays: 3 } } });
    const row = await (await instance()).from("todoist_connections").selectAll().where("user_id", "=", s.a.userId).executeTakeFirstOrThrow();
    expect(row.sync_token).toBeNull();
  });

  test("delivery defaults to push and round-trips", async () => {
    expect((await getSettings(s.a)).delivery).toBe("push");
    await putSettings(s.a, { webhookUrl: null, delivery: "both" });
    expect((await getSettings(s.a)).delivery).toBe("both");
    await putSettings(s.a, { webhookUrl: "https://ntfy.example/a" });
    expect(await getSettings(s.a)).toMatchObject({ delivery: "both", webhookUrl: "https://ntfy.example/a" });
    await expect(putSettings(s.a, { webhookUrl: null, delivery: "sms" as "push" })).rejects.toMatchObject({ code: "invalid_input" });
    expect((await getSettings(s.b)).delivery).toBe("push");
  });

  test("disconnect removes the viewer's tasks only", async () => {
    const i = await instance();
    await connectTodoist(s.a, "ta", fake());
    await connectTodoist(s.b, "tb", fake());
    await i.insert("todoist_tasks", taskRow(s.a.userId, "k1")).execute();
    await i.insert("todoist_tasks", taskRow(s.b.userId, "k1")).execute();
    await disconnectTodoist(s.a);
    expect(await todoistStatus(s.a)).toEqual({ connected: false });
    expect((await i.from("todoist_tasks").select("user_id").execute()).map((r) => r.user_id)).toEqual([s.b.userId]);
    expect((await i.from("todoist_connections").select("user_id").execute()).map((r) => r.user_id)).toEqual([s.b.userId]);
  });
});
