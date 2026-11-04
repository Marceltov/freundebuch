// A thin client for Todoist's unified API v1. The token is the user's secret: it is sent only in the Authorization header and never
// appears in a log line or an error message (a failed request is reported by status or error type only).
import { errorFields, logger } from "../core/log";

const log = logger("todoist");
const BASE = "https://api.todoist.com/api/v1";

/** Todoist refused the token (401/403): revoked or wrong. */
export class TodoistAuthError extends Error {
  constructor() {
    super("Todoist refused the token");
    this.name = "TodoistAuthError";
  }
}

/** Anything else that went wrong: a non-2xx answer, a network error, a timeout. */
export class TodoistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoistError";
  }
}

export type TodoistTask = { content: string; description: string; projectId: string; dueDate: string; deadlineDate?: string };
export type TodoistItem = { id: string; checked: boolean; deleted: boolean };

export function todoist(token: string, fetchFn: typeof fetch = fetch) {
  async function call(path: string, init: { method: "GET" | "POST"; json?: unknown; form?: URLSearchParams }): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = init.form.toString();
    }
    let res: Response;
    try {
      res = await fetchFn(`${BASE}${path}`, { method: init.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      log.warn({ err: { type: errorFields(e).type } }, "todoist request failed");
      throw new TodoistError("Todoist could not be reached");
    }
    if (res.status === 401 || res.status === 403) {
      log.warn({ status: res.status }, "todoist refused the token");
      throw new TodoistAuthError();
    }
    if (res.status < 200 || res.status >= 300) {
      log.warn({ status: res.status }, "todoist answered with an error");
      throw new TodoistError(`Todoist answered ${res.status}`);
    }
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  return {
    async projects(): Promise<{ id: string; name: string }[]> {
      const out: { id: string; name: string }[] = [];
      let cursor: string | null = null;
      do {
        const q: string = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : "?limit=200";
        const page = (await call(`/projects${q}`, { method: "GET" })) as { results?: { id: string; name: string }[]; next_cursor?: string | null } | null;
        for (const p of page?.results ?? []) out.push({ id: String(p.id), name: p.name });
        cursor = page?.next_cursor ?? null;
      } while (cursor);
      return out;
    },

    /** Creates a task with a date-only due date (and deadline); returns its Todoist id. */
    async createTask(t: TodoistTask): Promise<string> {
      const json: Record<string, string> = { content: t.content, description: t.description, project_id: t.projectId, due_date: t.dueDate };
      if (t.deadlineDate) json.deadline_date = t.deadlineDate;
      const res = (await call("/tasks", { method: "POST", json })) as { id?: string } | null;
      if (!res?.id) throw new TodoistError("Todoist did not return a task id");
      return String(res.id);
    },

    async closeTask(id: string): Promise<void> {
      await call(`/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
    },

    /** Incremental sync of items; null asks for everything. */
    async sync(syncToken: string | null): Promise<{ syncToken: string; items: TodoistItem[] }> {
      const form = new URLSearchParams({ sync_token: syncToken ?? "*", resource_types: JSON.stringify(["items"]) });
      const res = (await call("/sync", { method: "POST", form })) as {
        sync_token?: string;
        items?: { id: string; checked?: boolean; is_deleted?: boolean }[];
      } | null;
      if (!res?.sync_token) throw new TodoistError("Todoist did not return a sync token");
      return {
        syncToken: res.sync_token,
        items: (res.items ?? []).map((i) => ({ id: String(i.id), checked: i.checked === true, deleted: i.is_deleted === true })),
      };
    },
  };
}
