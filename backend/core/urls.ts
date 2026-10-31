// URLs the backend hands out: the public base, the two OAuth resources, and where to go after signing in.
import { config } from "./config";

// Absolute base URL: PUBLIC_URL, else derived from the request. X-Forwarded-* only behind a trusted proxy, like clientIp():
// a cache keyed on Host would otherwise serve links to whatever host a client sent.
export function publicUrl(headers: Headers): string {
  const fixed = config.publicUrl();
  if (fixed) return fixed;
  const first = (name: string) => headers.get(name)?.split(",")[0].trim();
  const fwd = (name: string) => (config.trustProxy() ? first(name) : undefined);
  const proto = fwd("x-forwarded-proto") ?? "http";
  const host = fwd("x-forwarded-host") ?? first("host") ?? "localhost";
  return `${proto}://${host}`;
}

export const API_PREFIX = "/api/v1";

// Where things open in the web app. The domain hands out paths; mcp.ts and the REST dispatcher make them absolute with
// absoluteUrls() just before a result leaves, so the pages, which read the domain in-process, get links they can use as they are.
export type AnchoredTable = "facts" | "promises" | "dates" | "exchanges" | "relationships";
export const personPath = (id: string) => `/p/${id}`;
export const conversationPath = (id: string) => `/c/${id}`;
/** A ramble: its transcript and what was filed from it. */
export const ramblePath = (id: string) => `/r/${id}`;
/** A place: everything the viewer may see that happened there. */
export const placePath = (id: string) => `/o/${id}`;
/** A series: its sessions by date. */
export const seriesPath = (id: string) => `/s/${id}`;
export const groupPath = (id: string) => `/g/${id}`;
/** A journal entry, highlighted on the Tagebuch page. */
export const journalPath = (id: string) => `/tagebuch#journal-${id}`;
export const filePath = (id: string) => `/api/files/${id}`;
/** The element id of an item's row on a page; a link ending in `#` + this scrolls to the row and highlights it. */
export const anchorId = (table: AnchoredTable, id: string) => `${table}-${id}`;
export const itemPath = (page: string, table: AnchoredTable, id: string) => `${page}#${anchorId(table, id)}`;

/** A copy of `body` with every `url` (and `imageUrl`) that is a path prefixed with `base`. */
export function absoluteUrls<T>(base: string, body: T): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x === null || typeof x !== "object") return x;
    return Object.fromEntries(
      Object.entries(x).map(([k, val]) => [k, (k === "url" || k === "imageUrl") && typeof val === "string" && val.startsWith("/") ? base + val : walk(val)]),
    );
  };
  return walk(body) as T;
}

// Where to go after signing in: a same-origin path, else "/". A second "/" or any "\" would make it
// protocol-relative (browsers read "\" as "/"), and browsers drop tabs and newlines, so "/\t/x" is "//x".
export const safeNext = (v: unknown): string => (typeof v === "string" && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : "/");

// The OAuth resources (RFC 8707) an access token may be for: the MCP endpoint, and the REST API for scripts.
export const mcpResource = (h: Headers) => `${publicUrl(h)}/mcp`;
export const apiResource = (h: Headers) => `${publicUrl(h)}${API_PREFIX}`;
export const resources = (h: Headers): string[] => [mcpResource(h), apiResource(h)];
