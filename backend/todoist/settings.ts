// A user's Todoist connection: the personal token (stored, never read back out), the project tasks go to and, per kind of due item,
// how many days ahead the task appears and whether the day is the task's due date or its deadline.
import { InvalidInputError } from "../core/errors";
import type { Viewer } from "../core/types";
import { instance } from "../db/scope";
import { TodoistAuthError, todoist } from "./client";

export type DueKind = "birthday" | "anniversary" | "date" | "promise";
export type KindSetting = { leadDays: number; placement: "due" | "deadline" };
export type Kinds = Record<DueKind, KindSetting>;

export const DEFAULT_KINDS: Kinds = {
  birthday: { leadDays: 1, placement: "due" },
  anniversary: { leadDays: 0, placement: "due" },
  date: { leadDays: 0, placement: "due" },
  promise: { leadDays: 0, placement: "due" },
};

export type TodoistStatus = { connected: false } | { connected: true; projectId: string; projectName: string; broken: boolean; kinds: Kinds };

const DUE_KINDS = Object.keys(DEFAULT_KINDS) as DueKind[];

function mergeKinds(stored: string): Kinds {
  let parsed: Partial<Kinds> = {};
  try {
    parsed = JSON.parse(stored) as Partial<Kinds>;
  } catch {
    // an unreadable value falls back to the defaults
  }
  return Object.fromEntries(DUE_KINDS.map((k) => [k, { ...DEFAULT_KINDS[k], ...parsed[k] }])) as Kinds;
}

/** Checks the token by listing projects; a refused token is the caller's mistake, not a failure of ours. */
async function listProjects(token: string, fetchFn: typeof fetch): Promise<{ id: string; name: string }[]> {
  try {
    return await todoist(token, fetchFn).projects();
  } catch (e) {
    if (e instanceof TodoistAuthError) throw new InvalidInputError("the Todoist token was not accepted");
    throw e;
  }
}

/** Stores the token (no project yet; a new connection starts over, but keeps the kinds) and returns the projects to choose from. */
export async function connectTodoist(v: Viewer, token: string, fetchFn: typeof fetch = fetch): Promise<{ id: string; name: string }[]> {
  const t = token.trim();
  if (!t) throw new InvalidInputError("token must not be empty");
  const projects = await listProjects(t, fetchFn);
  const reset = { token: t, project_id: null, project_name: null, sync_token: null, broken: 0 as const };
  await (
    await instance()
  )
    .insert("todoist_connections", { user_id: v.userId, ...reset, created_at: Date.now() })
    .onConflict((oc) => oc.column("user_id").doUpdateSet(reset))
    .execute();
  return projects;
}

async function connectionOf(v: Viewer) {
  const row = await (await instance()).from("todoist_connections").selectAll().where("user_id", "=", v.userId).executeTakeFirst();
  if (!row) throw new InvalidInputError("Todoist is not connected");
  return row;
}

export async function setTodoistProject(v: Viewer, projectId: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const row = await connectionOf(v);
  const project = (await listProjects(row.token, fetchFn)).find((p) => p.id === projectId);
  if (!project) throw new InvalidInputError("projectId is not one of the Todoist projects");
  await (
    await instance()
  )
    .update("todoist_connections")
    .set({ project_id: project.id, project_name: project.name, sync_token: null, broken: 0 })
    .where("user_id", "=", v.userId)
    .execute();
}

export async function setTodoistKinds(v: Viewer, kinds: Partial<Kinds>): Promise<void> {
  const row = await connectionOf(v);
  const next = mergeKinds(row.kinds);
  for (const [k, setting] of Object.entries(kinds)) {
    if (!DUE_KINDS.includes(k as DueKind)) throw new InvalidInputError(`kind must be one of ${DUE_KINDS.join(", ")}`);
    const { leadDays, placement } = setting as KindSetting;
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 60) throw new InvalidInputError("leadDays must be a whole number from 0 to 60");
    if (placement !== "due" && placement !== "deadline") throw new InvalidInputError('placement must be "due" or "deadline"');
    next[k as DueKind] = { leadDays, placement };
  }
  await (
    await instance()
  )
    .update("todoist_connections")
    .set({ kinds: JSON.stringify(next) })
    .where("user_id", "=", v.userId)
    .execute();
}

/** Connected means a project is chosen too; the token is never part of this. */
export async function todoistStatus(v: Viewer): Promise<TodoistStatus> {
  const row = await (await instance()).from("todoist_connections").selectAll().where("user_id", "=", v.userId).executeTakeFirst();
  if (!row || !row.project_id) return { connected: false };
  return { connected: true, projectId: row.project_id, projectName: row.project_name ?? "", broken: row.broken === 1, kinds: mergeKinds(row.kinds) };
}

/** Forgets the connection and which tasks were made; the tasks in Todoist stay. */
export async function disconnectTodoist(v: Viewer): Promise<void> {
  const i = await instance();
  await i.delete("todoist_tasks").where("user_id", "=", v.userId).execute();
  await i.delete("todoist_connections").where("user_id", "=", v.userId).execute();
}
