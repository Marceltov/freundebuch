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

// Where to go after signing in: a same-origin path, else "/". A second "/" or any "\" would make it
// protocol-relative (browsers read "\" as "/"), and browsers drop tabs and newlines, so "/\t/x" is "//x".
export const safeNext = (v: unknown): string => (typeof v === "string" && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : "/");

// The OAuth resources (RFC 8707) an access token may be for: the MCP endpoint, and the REST API for scripts.
export const mcpResource = (h: Headers) => `${publicUrl(h)}/mcp`;
export const apiResource = (h: Headers) => `${publicUrl(h)}${API_PREFIX}`;
export const resources = (h: Headers): string[] => [mcpResource(h), apiResource(h)];
