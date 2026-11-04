import { afterEach, beforeEach, expect, test } from "vitest";
import { instance } from "../db/scope";
import { listPending } from "../conversations/files";
import { setTranscriberForTests } from "../conversations/transcribe";
import { seed, type Seed } from "../testing/fixtures";
import { toolByName } from "../mcp/tools";
import { DEFAULT_KINDS } from "./settings";
import { pullNow, syncUser } from "./sync";

// An in-memory Todoist with comments (notes). The sync answers with what changed since the token; the user only on a full sync.
// An attachment's file_url answers with a redirect to a signed address, which serves the bytes without the token.
type Note = {
  id: string;
  item_id: string;
  posted_uid: string;
  posted_at: string;
  content: string;
  is_deleted: boolean;
  file?: { type: string; bytes: Uint8Array };
  changed: number;
};
type Account = { uid: string; notes: Note[]; failDownload?: boolean };
let accounts: Map<string, Account>;
let clock: number;
const downloads: { url: string; auth: boolean }[] = [];
const fetchFn = (async (url: string, init: RequestInit = {}) => {
  const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
  const u = new URL(url);
  downloads.push({ url, auth: !!auth });
  if (u.host === "files.todoist.com") {
    const acc = accounts.get(auth!.replace("Bearer ", ""))!;
    if (acc.failDownload) return new Response(null, { status: 503 });
    return new Response(null, { status: 302, headers: { Location: `https://cdn.example${u.pathname}` } });
  }
  if (u.host === "cdn.example") {
    if (auth) return new Response(null, { status: 400 });
    const note = [...accounts.values()].flatMap((a) => a.notes).find((n) => u.pathname === `/${n.id}`)!;
    return new Response(Buffer.from(note.file!.bytes), { status: 200, headers: { "Content-Type": note.file!.type } });
  }
  const acc = accounts.get(auth!.replace("Bearer ", ""))!;
  if (u.pathname === "/api/v1/sync") {
    const form = new URLSearchParams(init.body as string);
    const since = form.get("sync_token");
    const after = since === "*" ? 0 : Number(since);
    const notes = acc.notes
      .filter((n) => n.changed > after)
      .map(({ file, ...n }) => ({
        ...n,
        file_attachment: file
          ? { file_url: `https://files.todoist.com/${n.id}`, file_type: file.type, file_name: "blob", file_size: file.bytes.byteLength }
          : null,
      }));
    return Response.json({ sync_token: String(clock), items: [], notes, ...(since === "*" ? { user: { id: acc.uid } } : {}) });
  }
  return new Response(null, { status: 404 });
}) as unknown as typeof fetch;

let s: Seed;
const NOW = Date.parse("2026-11-04T10:00:00Z");
const wav = () => {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("RIFF"), 0);
  b.set(new TextEncoder().encode("WAVE"), 8);
  return b;
};

async function connect(userId: string, token: string, uid: string, backfilled = 0) {
  accounts.set(token, { uid, notes: [] });
  await (
    await instance()
  )
    .insert("todoist_connections", {
      user_id: userId,
      token,
      project_id: "p1",
      project_name: "Freunde",
      kinds: JSON.stringify(DEFAULT_KINDS),
      broken: 0,
      notes_backfilled: backfilled,
      sync_token: backfilled ? "0" : null,
      created_at: 1,
    })
    .execute();
}
async function task(userId: string, taskId: string, bookId: string, personId: string, title: string | null = "Frag Anna nach der Haussuche") {
  await (
    await instance()
  )
    .insert("todoist_tasks", {
      user_id: userId,
      key: `situation|${bookId}|f-${taskId}|2026-11-01`,
      task_id: taskId,
      book_id: bookId,
      kind: "situation",
      item_id: `f-${taskId}`,
      person_id: personId,
      day: "2026-11-01",
      state: "open",
      title,
      created_at: 1,
    })
    .execute();
}
const note = (token: string, n: Partial<Note> & { id: string; item_id: string }) =>
  accounts
    .get(token)!
    .notes.push({ posted_uid: accounts.get(token)!.uid, posted_at: "2026-11-04T09:00:00Z", content: "", is_deleted: false, changed: ++clock, ...n });

beforeEach(async () => {
  s = await seed();
  accounts = new Map();
  clock = 0;
  downloads.length = 0;
  setTranscriberForTests({ transcribe: async () => ({ text: "Sie haben ein Haus in Pasing gekauft" }) });
  await connect(s.a.userId, "ta", "u-a", 1);
  await task(s.a.userId, "t1", s.a.bookId, s.anna);
});
afterEach(() => setTranscriberForTests(null));

test("a text comment on a task comes into Prüfen with its task and its day", async () => {
  // 23:30 in Berlin on 3 November.
  note("ta", { id: "n1", item_id: "t1", content: "Hab Anna angerufen", posted_at: "2026-11-03T22:30:00Z" });
  await syncUser(s.a.userId, NOW, fetchFn);
  const [file] = await listPending(s.a);
  expect(file).toMatchObject({ type: "text/plain", sharedOn: "2026-11-03", batchId: "todoist-t1" });
  expect(file.context).toEqual({ source: "todoist", taskTitle: "Frag Anna nach der Haussuche", kind: "situation", personId: s.anna, itemId: "f-t1" });
});

test("a voice message comes as audio, with its text, in the task's batch; the download sends the token only to Todoist", async () => {
  note("ta", { id: "n1", item_id: "t1", content: "Sprachnachricht", file: { type: "audio/wav", bytes: wav() } });
  await syncUser(s.a.userId, NOW, fetchFn);
  const files = await listPending(s.a);
  expect(files.map((f) => f.type).sort()).toEqual(["audio/wav", "text/plain"]);
  expect(new Set(files.map((f) => f.batchId))).toEqual(new Set(["todoist-t1"]));
  expect(downloads.filter((d) => d.url.includes("cdn.example")).every((d) => !d.auth)).toBe(true);
});

test("a collaborator's comment and a comment on a task freundebuch didn't make are left out", async () => {
  note("ta", { id: "n1", item_id: "t1", content: "Von jemand anderem", posted_uid: "u-other" });
  note("ta", { id: "n2", item_id: "not-ours", content: "Fremde Aufgabe" });
  await syncUser(s.a.userId, NOW, fetchFn);
  expect(await listPending(s.a)).toEqual([]);
});

test("the partner's comments land in the partner's Prüfen only", async () => {
  await connect(s.b.userId, "tb", "u-b", 1);
  await task(s.b.userId, "t9", s.b.bookId, s.anna);
  note("tb", { id: "n9", item_id: "t9", content: "Nur für B" });
  await syncUser(s.a.userId, NOW, fetchFn);
  await syncUser(s.b.userId, NOW, fetchFn);
  expect(await listPending(s.a)).toEqual([]);
  expect((await listPending(s.b)).map((f) => f.context?.taskTitle)).toEqual(["Frag Anna nach der Haussuche"]);
});

test("the same comment seen by two pulls at once becomes one file", async () => {
  note("ta", { id: "n1", item_id: "t1", content: "Einmal" });
  await Promise.all([pullNow(s.a, fetchFn), syncUser(s.a.userId, NOW, fetchFn)]);
  await syncUser(s.a.userId, NOW, fetchFn);
  expect(await listPending(s.a)).toHaveLength(1);
});

test("an attachment Todoist won't serve: the text still comes in once, and the sync goes on", async () => {
  accounts.get("ta")!.failDownload = true;
  note("ta", { id: "n1", item_id: "t1", content: "Mit Foto", file: { type: "image/png", bytes: new Uint8Array([1, 2, 3]) } });
  await syncUser(s.a.userId, NOW, fetchFn);
  await syncUser(s.a.userId, NOW, fetchFn);
  expect((await listPending(s.a)).map((f) => f.type)).toEqual(["text/plain"]);
  const conn = await (await instance()).from("todoist_connections").select("sync_token").where("user_id", "=", s.a.userId).executeTakeFirst();
  expect(conn?.sync_token).toBe(String(clock));
});

test("a comment written before comments were read comes in once, by the one full read", async () => {
  await (await instance()).update("todoist_connections").set({ notes_backfilled: 0, sync_token: "5" }).where("user_id", "=", s.a.userId).execute();
  clock = 10;
  accounts
    .get("ta")!
    .notes.push({ id: "old", item_id: "t1", posted_uid: "u-a", posted_at: "2026-11-04T08:00:00Z", content: "Schon da", is_deleted: false, changed: 1 });
  await syncUser(s.a.userId, NOW, fetchFn);
  await syncUser(s.a.userId, NOW, fetchFn);
  expect((await listPending(s.a)).map((f) => f.context?.taskTitle)).toEqual(["Frag Anna nach der Haussuche"]);
});

test("the inbox tells Claude to propose what a Todoist comment means", async () => {
  note("ta", { id: "n1", item_id: "t1", content: "Sie haben eins" });
  await syncUser(s.a.userId, NOW, fetchFn);
  const out = (await toolByName("inbox")!.run(s.a, { action: "list" })) as { next: string[] };
  expect(out.next.join("\n")).toContain(
    'This is a comment the user left on the Todoist task "Frag Anna nach der Haussuche". Propose from what it says: a contact or news → file it with record (that settles the task); only a note → file that and leave the task open; nothing came of it → inbox done.',
  );
});

test("an attachment that lives outside Todoist is never fetched with the token; its text still comes in", async () => {
  note("ta", { id: "n1", item_id: "t1", content: "Link angehängt", file: { type: "application/pdf", bytes: new Uint8Array([1]) } });
  const real = fetchFn;
  const outside = (async (url: string, init?: RequestInit) =>
    real(url.replace("https://files.todoist.com/", "https://drive.example/"), init)) as unknown as typeof fetch;
  // The sync answers with a file_url on another host.
  const viaDrive = (async (url: string, init?: RequestInit) => {
    const res = await outside(url, init);
    if (!url.endsWith("/api/v1/sync")) return res;
    const body = (await res.json()) as { notes: { file_attachment: { file_url: string } | null }[] };
    for (const n of body.notes) if (n.file_attachment) n.file_attachment.file_url = n.file_attachment.file_url.replace("files.todoist.com", "drive.example");
    return Response.json(body);
  }) as unknown as typeof fetch;
  await syncUser(s.a.userId, NOW, viaDrive);
  expect(downloads.filter((d) => d.url.includes("drive.example") && d.auth)).toEqual([]);
  expect((await listPending(s.a)).map((f) => f.type)).toEqual(["text/plain"]);
});
