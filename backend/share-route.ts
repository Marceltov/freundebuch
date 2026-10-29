// POST /api/share: a file comes in from a phone or the app. The iPhone Shortcut sends it as the body with the user's share
// key (`Authorization: Bearer fbs_…`); the web app's share page (Android) sends it as the form field `file` with the cookie.
// An API access token works too. 202: stored, Claude reads it in the background. Not in the REST table: its body isn't JSON.
// GET /api/files/{id}: the file, for whoever may see it (fileContent).
// Without an API key (and outside e2e) there is no sharing: 404.
import { bearerOf, viewerFromRequest } from "./auth/session";
import { FreundebuchError } from "./errors";
import { readCapped, parseForm } from "./http/request";
import { copy } from "./notify/copy";
import { config } from "./config";
import { MAX_UPLOAD, PENDING_PATH, queueRead, fileContent, fileModel, shareFile, viewerFromShareKey } from "./files";
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
async function fileOf(req: Request, bytes: Uint8Array): Promise<{ bytes: Uint8Array; type: string } | null> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const form = await parseForm(bytes, req.headers).catch(() => null);
    const file = form?.get("file") ?? form?.get("image");
    return file instanceof Blob ? { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type } : null;
  }
  // The Shortcut's "File" body sends the file's own type; some versions send none or octet-stream.
  return { bytes, type };
}

export async function shareRoute(req: Request): Promise<Response> {
  const model = fileModel();
  if (!model) return json({ error: "not found", code: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const v = await viewerOf(req);
  if (!v) return json({ error: "sign-in or share key required", code: "unauthorized" }, 401);
  const bytes = await readCapped(req, MAX_UPLOAD);
  if (!bytes) return json({ error: `The image is larger than ${MAX_UPLOAD / 1024 / 1024} MB`, code: "invalid_request" }, 413);
  const file = await fileOf(req, bytes);
  if (!file) return json({ error: "Send the file as the body, or as the form field `file`", code: "invalid_request" }, 400);
  try {
    const shot = await shareFile(v, file.bytes, file.type);
    if (!shot.duplicate) void queueRead(shot.id, model);
    // `message` is what the Shortcut shows.
    // `url` is where it waits, for the Shortcut to open as its last step.
    return json({ ...shot, message: shot.duplicate ? copy.shareDuplicate : copy.shareThanks, url: `${config.publicUrl() ?? ""}${PENDING_PATH}#${shot.id}` }, 202);
  } catch (e) {
    if (e instanceof FreundebuchError && e.code === "invalid_input") return json({ error: e.message, code: e.code }, 400);
    throw e;
  }
}

export async function fileRoute(req: Request, id: string): Promise<Response> {
  const v = await viewerFromRequest(req, "api");
  if (!v) return json({ error: "sign-in required", code: "unauthorized" }, 401);
  const img = await fileContent(v, id);
  if (!img) return json({ error: "not found", code: "not_found" }, 404);
  return new Response(img.bytes as BodyInit, {
    headers: { "Content-Type": img.type === "text/plain" ? "text/plain; charset=utf-8" : img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
