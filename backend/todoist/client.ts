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

/** Anything else that went wrong: a non-2xx answer (`status`), a network error or a timeout (no status). */
export class TodoistError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "TodoistError";
  }
}

export type TodoistTask = { content: string; description: string; projectId: string; dueDate: string; deadlineDate?: string };
export type TodoistItem = { id: string; checked: boolean; deleted: boolean };
/** A comment on a task; `attachment.url` needs the token and answers with a redirect to the file. */
export type TodoistNote = {
  id: string;
  itemId: string;
  postedUid: string;
  postedAt: string;
  content: string;
  deleted: boolean;
  attachment: { url: string; type: string; name: string; size: number } | null;
};

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
      throw new TodoistError(`Todoist answered ${res.status}`, res.status);
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

    /** A task's text (content), or null when Todoist has none. */
    async taskContent(id: string): Promise<string | null> {
      const res = (await call(`/tasks/${encodeURIComponent(id)}`, { method: "GET" })) as { content?: string } | null;
      return res?.content ?? null;
    },

    async closeTask(id: string): Promise<void> {
      await call(`/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
    },

    /** Incremental sync of items and their comments; null asks for everything. `userId` comes only with a full sync. */
    async sync(syncToken: string | null): Promise<{ syncToken: string; items: TodoistItem[]; notes: TodoistNote[]; userId: string | null }> {
      const form = new URLSearchParams({ sync_token: syncToken ?? "*", resource_types: JSON.stringify(["items", "notes", "user"]) });
      const res = (await call("/sync", { method: "POST", form })) as {
        sync_token?: string;
        items?: { id: string; checked?: boolean; is_deleted?: boolean }[];
        notes?: {
          id: string;
          item_id: string;
          posted_uid: string;
          posted_at: string;
          content?: string;
          is_deleted?: boolean;
          file_attachment?: { file_url?: string; file_type?: string; file_name?: string; file_size?: number } | null;
        }[];
        user?: { id?: string };
      } | null;
      if (!res?.sync_token) throw new TodoistError("Todoist did not return a sync token");
      return {
        syncToken: res.sync_token,
        items: (res.items ?? []).map((i) => ({ id: String(i.id), checked: i.checked === true, deleted: i.is_deleted === true })),
        notes: (res.notes ?? []).map((n) => {
          const f = n.file_attachment;
          return {
            id: String(n.id),
            itemId: String(n.item_id),
            postedUid: String(n.posted_uid),
            postedAt: n.posted_at,
            content: n.content ?? "",
            deleted: n.is_deleted === true,
            attachment: f?.file_url ? { url: f.file_url, type: f.file_type ?? "", name: f.file_name ?? "", size: f.file_size ?? 0 } : null,
          };
        }),
        userId: res.user?.id ? String(res.user.id) : null,
      };
    },

    /** The account's own user id (for a full sync that came without it). */
    async userId(): Promise<string | null> {
      const res = (await call("/user", { method: "GET" })) as { id?: string } | null;
      return res?.id ? String(res.id) : null;
    },

    /** A comment's file: its URL answers, with the token, with a redirect to a signed https address, fetched without the token.
     * Only for https addresses on todoist.com; neither URL is logged. Refuses more than `max` bytes. */
    async download(url: string, max: number): Promise<{ bytes: Uint8Array; type: string }> {
      // The token only ever goes to Todoist itself: an attachment elsewhere (a Drive or Dropbox link) is left out.
      const at = new URL(url);
      if (at.protocol !== "https:" || !(at.hostname === "todoist.com" || at.hostname.endsWith(".todoist.com")))
        throw new TodoistError("The file is not on Todoist");
      const get = async (u: string, auth: boolean) => {
        try {
          return await fetchFn(u, { headers: auth ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual", signal: AbortSignal.timeout(30_000) });
        } catch (e) {
          log.warn({ err: { type: errorFields(e).type } }, "todoist file download failed");
          throw new TodoistError("Todoist could not be reached");
        }
      };
      let res = await get(url, true);
      if (res.status >= 300 && res.status < 400) {
        const to = res.headers.get("location");
        if (!to || new URL(to, url).protocol !== "https:") throw new TodoistError("Todoist sent no file address");
        res = await get(new URL(to, url).href, false);
      }
      if (res.status < 200 || res.status >= 300) {
        log.warn({ status: res.status }, "todoist file download answered with an error");
        throw new TodoistError(`Todoist answered ${res.status}`, res.status);
      }
      if (Number(res.headers.get("content-length") ?? 0) > max) throw new TodoistError("The file is too large");
      // Read with a cap: an answer without a length can't run past `max` in memory.
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body?.getReader();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new TodoistError("The file is too large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return { bytes, type: (res.headers.get("content-type") ?? "").split(";")[0].trim() };
    },
  };
}
