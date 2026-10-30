// POST /api/share: a file comes in from a phone or the app. The iPhone Shortcut sends it as the body with the user's share
// key (`Authorization: Bearer fbs_…`); the web app's share page (Android) sends it as the form field `file` with the cookie.
// Files shared in one go carry one id in `X-Freundebuch-Batch` (or the form field `batch`): see files.ts.
// An API access token works too. 202: stored, Claude reads it in the background. Not in the REST table: its body isn't JSON.
// GET /api/files/{id}: the file, for whoever may see it (fileContent).
// Without an API key (and outside e2e) there is no sharing: 404.
import { bearerOf, viewerFromRequest } from "./auth/session";
import { FreundebuchError } from "./errors";
import { readCapped, parseForm } from "./http/request";
import { notifyCopy, type NotifyCopy } from "./notify/copy";
import { userLanguage } from "./settings";
import { BATCH_HEADER, MAX_UPLOAD, NO_AUDIO, NOT_AUDIO, NOT_TAKEN, PENDING_PATH, queueRead, fileContent, fileModel, shareFile, viewerFromShareKey } from "./files";
import { TOO_LARGE } from "./heic";
import { publicUrl } from "./urls";
import type { Viewer } from "./types";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Whether this instance takes shared files: the same switch as the chat. */
export const sharingEnabled = (): boolean => fileModel() !== null;

async function viewerOf(req: Request): Promise<Viewer | null> {
  const bearer = bearerOf(req.headers.get("authorization"));
  if (bearer.startsWith("fbs_")) return viewerFromShareKey(bearer);
  return viewerFromRequest(req, "api");
}

/** The shared file and the type it was sent as: the form field `file` (or `image`, as older share pages send it), else the body. */
async function fileOf(req: Request, bytes: Uint8Array): Promise<{ bytes: Uint8Array; type: string; batch: string | null } | null> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const header = req.headers.get(BATCH_HEADER);
  if (type.startsWith("multipart/form-data")) {
    const form = await parseForm(bytes, req.headers).catch(() => null);
    const file = form?.get("file") ?? form?.get("image");
    const field = form?.get("batch");
    return file instanceof Blob ? { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, batch: header ?? (typeof field === "string" ? field : null) } : null;
  }
  // The Shortcut's "File" body sends the file's own type; some versions send none or octet-stream.
  return { bytes, type, batch: header };
}

/** Why a file was refused (files.ts, heic.ts), for the user. */
function forUser(copy: NotifyCopy, error: string): string {
  if (error === NOT_TAKEN) return copy.shareNotTaken;
  if (error === NO_AUDIO) return copy.shareNoAudio;
  if (error === NOT_AUDIO) return copy.shareNotAudio;
  if (error === TOO_LARGE) return copy.shareTooManyPixels;
  if (error.startsWith("The text file is too long")) return copy.shareTextTooLong;
  if (error === "The file is empty") return copy.shareEmpty;
  return copy.shareUnreadable;
}

export async function shareRoute(req: Request): Promise<Response> {
  const model = fileModel();
  if (!model) return json({ error: "not found", code: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const v = await viewerOf(req);
  // `message`, here and below, is what the Shortcut shows when a file didn't arrive, in the user's language (German while the key
  // doesn't say who they are).
  if (!v) return json({ error: "sign-in or share key required", code: "unauthorized", message: notifyCopy("de").shareBadKey }, 401);
  const copy = notifyCopy(await userLanguage(v));
  const bytes = await readCapped(req, MAX_UPLOAD);
  if (!bytes) return json({ error: `The image is larger than ${MAX_UPLOAD / 1024 / 1024} MB`, code: "invalid_request", message: copy.shareTooLarge }, 413);
  const file = await fileOf(req, bytes);
  if (!file) return json({ error: "Send the file as the body, or as the form field `file`", code: "invalid_request", message: copy.shareUnreadable }, 400);
  try {
    const shot = await shareFile(v, file.bytes, file.type, file.batch);
    if (!shot.duplicate) void queueRead(shot.id, model);
    // `message` is what the Shortcut shows.
    // `url` is where it waits, for the Shortcut to open as its last step.
    // An absolute address even without PUBLIC_URL: the Shortcut can't open a path.
    return json({ ...shot, message: shot.duplicate ? copy.shareDuplicate : copy.shareThanks, url: `${publicUrl(req.headers)}${PENDING_PATH}#${shot.id}` }, 202);
  } catch (e) {
    if (e instanceof FreundebuchError && e.code === "invalid_input") return json({ error: e.message, code: e.code, message: forUser(copy, e.message) }, 400);
    throw e;
  }
}

export async function fileRoute(req: Request, id: string): Promise<Response> {
  const v = await viewerFromRequest(req, "api");
  if (!v) return json({ error: "sign-in required", code: "unauthorized" }, 401);
  const img = await fileContent(v, id);
  if (!img) return json({ error: "not found", code: "not_found" }, 404);
  const headers = { "Content-Type": img.type === "text/plain" ? "text/plain; charset=utf-8" : img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
  // Safari plays a voice note only from a server that answers byte ranges.
  const range = rangeOf(req.headers.get("range"), img.bytes.byteLength);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${img.bytes.byteLength}` } });
  if (range) return new Response(img.bytes.subarray(range.start, range.end + 1) as BodyInit, { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${img.bytes.byteLength}` } });
  return new Response(img.bytes as BodyInit, { headers });
}

/** One byte range (`bytes=0-1`, `bytes=5-`, `bytes=-5`) of `size` bytes; null for none or one not understood (the whole file is sent). */
export function rangeOf(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  const [start, end] = m[1] ? [Number(m[1]), m[2] ? Math.min(Number(m[2]), size - 1) : size - 1] : [Math.max(0, size - Number(m[2])), size - 1];
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}
