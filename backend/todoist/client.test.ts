import { describe, expect, test } from "vitest";
import { logsOf } from "../core/log";
import { TodoistAuthError, TodoistError, todoist } from "./client";

type Call = { url: string; init: RequestInit };
const fake = (...answers: { status?: number; body?: unknown }[]) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("todoist client", () => {
  test("projects follows the cursor and sends the bearer token", async () => {
    const { calls, fetchFn } = fake(
      { body: { results: [{ id: "1", name: "Inbox", extra: 1 }], next_cursor: "abc" } },
      { body: { results: [{ id: "2", name: "Friends" }], next_cursor: null } },
    );
    expect(await todoist("tok", fetchFn).projects()).toEqual([
      { id: "1", name: "Inbox" },
      { id: "2", name: "Friends" },
    ]);
    expect(calls[1].url).toContain("cursor=abc");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("createTask sends due_date and deadline_date", async () => {
    const { calls, fetchFn } = fake({ body: { id: "t9" } });
    const id = await todoist("tok", fetchFn).createTask({
      content: "Call Jörg",
      description: "link",
      projectId: "p1",
      dueDate: "2026-12-01",
      deadlineDate: "2026-12-03",
    });
    expect(id).toBe("t9");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toMatch(/\/tasks$/);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      content: "Call Jörg",
      description: "link",
      project_id: "p1",
      due_date: "2026-12-01",
      deadline_date: "2026-12-03",
    });
  });

  test("createTask leaves deadline_date out when there is none", async () => {
    const { calls, fetchFn } = fake({ body: { id: "t9" } });
    await todoist("tok", fetchFn).createTask({ content: "c", description: "", projectId: "p1", dueDate: "2026-12-01" });
    expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty("deadline_date");
  });

  test("closeTask POSTs to the close endpoint", async () => {
    const { calls, fetchFn } = fake({ status: 204 });
    await todoist("tok", fetchFn).closeTask("t 1");
    expect(calls[0].url).toMatch(/\/tasks\/t%201\/close$/);
    expect(calls[0].init.method).toBe("POST");
  });

  test("sync(null) asks for everything and maps checked and is_deleted", async () => {
    const { calls, fetchFn } = fake({
      body: {
        sync_token: "next",
        items: [
          { id: "a", checked: true, is_deleted: false },
          { id: "b", checked: false, is_deleted: true },
        ],
      },
    });
    const r = await todoist("tok", fetchFn).sync(null);
    expect(r).toEqual({
      syncToken: "next",
      items: [
        { id: "a", checked: true, deleted: false },
        { id: "b", checked: false, deleted: true },
      ],
    });
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get("sync_token")).toBe("*");
    expect(body.get("resource_types")).toBe('["items"]');
  });

  test("sync passes a stored token on", async () => {
    const { calls, fetchFn } = fake({ body: { sync_token: "n2" } });
    expect((await todoist("tok", fetchFn).sync("old")).items).toEqual([]);
    expect(new URLSearchParams(calls[0].init.body as string).get("sync_token")).toBe("old");
  });

  test.each([401, 403])("%i throws TodoistAuthError", async (status) => {
    const { fetchFn } = fake({ status });
    await expect(todoist("tok", fetchFn).projects()).rejects.toBeInstanceOf(TodoistAuthError);
  });

  test("500 throws TodoistError, not TodoistAuthError", async () => {
    const { fetchFn } = fake({ status: 500 });
    const err = await todoist("tok", fetchFn)
      .projects()
      .catch((e) => e);
    expect(err).toBeInstanceOf(TodoistError);
    expect(err).not.toBeInstanceOf(TodoistAuthError);
    expect(err.status).toBe(500);
  });

  test("a network error is a TodoistError", async () => {
    const fetchFn = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const err = await todoist("tok", fetchFn)
      .closeTask("1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(TodoistError);
    expect(err.status).toBeNull();
  });

  test("no log line or error message contains the token", async () => {
    const token = "secret-token-123";
    const fetchFn = (async () => {
      throw new Error(`failed with Bearer ${token}`);
    }) as unknown as typeof fetch;
    const { fetchFn: bad } = fake({ status: 500, body: { error: token } });
    const messages: string[] = [];
    const lines = await logsOf(async () => {
      for (const f of [fetchFn, bad])
        await todoist(token, f)
          .projects()
          .catch((e) => messages.push(e.message));
    });
    expect(messages).toHaveLength(2);
    expect(JSON.stringify([lines, messages])).not.toContain(token);
  });
});
