// POST /api/share: a screenshot comes in from a phone. The iPhone Shortcut sends the image as the body with the user's share
// key (`Authorization: Bearer fbs_…`); the web app's share page (Android) sends it as the form field `image` with the cookie.
// An API access token works too. 202: stored, Claude reads it in the background. Not in the REST table: its body isn't JSON.
// GET /api/screenshots/{id}: the image, for whoever may see it (screenshotImage).
// Without an API key (and outside e2e) there is no sharing: 404.
import { bearerOf, viewerFromRequest } from "./auth/session";
import { FreundebuchError } from "./errors";
import { readCapped, parseForm } from "./http/request";
import { copy } from "./notify/copy";
import { MAX_UPLOAD, queueRead, screenshotImage, screenshotModel, shareScreenshot, viewerFromShareKey } from "./screenshots";
import type { Viewer } from "./types";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Whether this instance takes screenshots: the same switch as the chat. */
export const sharingEnabled = (): boolean => screenshotModel() !== null;

async function viewerOf(req: Request): Promise<Viewer | null> {
  const bearer = bearerOf(req.headers.get("authorization"));
  if (bearer.startsWith("fbs_")) return viewerFromShareKey(bearer);
  return viewerFromRequest(req, "api");
}

async function imageOf(req: Request, bytes: Uint8Array): Promise<Uint8Array | null> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const form = await parseForm(bytes, req.headers).catch(() => null);
    const file = form?.get("image");
    return file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : null;
  }
  // The Shortcut's "File" body sends the image's own type; some versions send none or octet-stream.
  if (type === "" || type.startsWith("image/") || type.startsWith("application/octet-stream")) return bytes;
  return null;
}

export async function shareRoute(req: Request): Promise<Response> {
  const model = screenshotModel();
  if (!model) return json({ error: "not found", code: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const v = await viewerOf(req);
  if (!v) return json({ error: "sign-in or share key required", code: "unauthorized" }, 401);
  const bytes = await readCapped(req, MAX_UPLOAD);
  if (!bytes) return json({ error: `The image is larger than ${MAX_UPLOAD / 1024 / 1024} MB`, code: "invalid_request" }, 413);
  const image = await imageOf(req, bytes);
  if (!image) return json({ error: "Send the image as the body, or as the form field `image`", code: "invalid_request" }, 400);
  try {
    const shot = await shareScreenshot(v, image);
    if (!shot.duplicate) void queueRead(shot.id, model);
    // `message` is what the Shortcut shows.
    return json({ ...shot, message: shot.duplicate ? copy.shareDuplicate : copy.shareThanks }, 202);
  } catch (e) {
    if (e instanceof FreundebuchError && e.code === "invalid_input") return json({ error: e.message, code: e.code }, 400);
    throw e;
  }
}

export async function screenshotRoute(req: Request, id: string): Promise<Response> {
  const v = await viewerFromRequest(req, "api");
  if (!v) return json({ error: "sign-in required", code: "unauthorized" }, 401);
  const img = await screenshotImage(v, id);
  if (!img) return json({ error: "not found", code: "not_found" }, 404);
  return new Response(img.bytes as BodyInit, {
    headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
