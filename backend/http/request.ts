// Reading requests and answering with redirects, for the handlers in backend/.
import { publicUrl } from "../core/urls";

// Reads at most `max` bytes; null (and the stream cancelled) as soon as the body is larger. A body that ends
// before the Content-Length it declared was cut short on its way (a proxy's buffer limit, a dropped
// connection): null too. Content-Length can be absent (chunked) or too large for the cap's sake, so it is
// never trusted for the cap. The chunks are kept as they come and joined at the end, so a small body costs
// its own size, not the cap.
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (Number(declared) > max) return null;
  if (!req.body) return declared !== null && Number(declared) > 0 ? null : new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  if (declared !== null && size < Number(declared)) return null;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// Form fields from an already-read body (multipart or urlencoded), parsed by the platform.
export const parseForm = (bytes: Uint8Array, h: Headers) =>
  new Response(bytes as BodyInit, { headers: { "content-type": h.get("content-type") ?? "" } }).formData();

// A small form post's fields; null when the body is too large or not a form.
export async function readFields(req: Request, max: number): Promise<FormData | null> {
  const bytes = await readCapped(req, max);
  return bytes ? parseForm(bytes, req.headers).catch(() => null) : null;
}

export function cookie(h: Headers, name: string): string | undefined {
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// A browser on this instance's own pages: the Origin's host is the public host. Browsers send Origin
// on every POST, so a missing one is not same-origin.
export function sameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  return origin !== null && URL.canParse(origin) && new URL(origin).host === new URL(publicUrl(h)).host;
}

// `headers` may repeat a name (two Set-Cookie).
export function seeOther(location: string, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Location", location);
  return new Response(null, { status: 303, headers: h });
}
