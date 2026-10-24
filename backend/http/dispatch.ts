// Table entries and the dispatcher for /api/v1. An entry's handler is typed from the entry's own
// declared responses, so it can't return a status or body shape the API description doesn't list;
// the dispatcher enforces the same at runtime for what types can't see (thrown errors, formats).
import * as z from "zod";
import { requireViewer } from "../auth/session";
import { InvalidRequestError, NotFoundError } from "../errors";
import { logger } from "../log";
import type { Viewer } from "../types";
import { errorReply } from "./errors";
import { readCapped } from "./request";

const log = logger("http");

/** The largest JSON body the API reads: a transcript is at most 200,000 characters, which is under 1 MiB even as UTF-8. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// A response without a schema has no body (e.g. a 204).
export type ResponseSpec = { description: string; schema?: z.ZodType };

type BodyOf<R> = R extends { schema: infer S extends z.ZodType } ? z.infer<S> : undefined;
export type Reply<R> = {
  [S in keyof R & number]: { status: S; body: BodyOf<R[S]> };
}[keyof R & number];

type QueryOf<Q> = Q extends z.ZodObject ? z.infer<Q> : Record<string, never>;
type JsonOf<B> = B extends z.ZodType ? z.infer<B> : undefined;

type Meta<R, Q, B> = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // OpenAPI template including /api/v1, e.g. "/api/v1/people/{id}"
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  auth: true; // every entry needs a signed-in viewer; the dispatcher resolves it before anything else
  params: Record<string, z.ZodType>;
  query?: Q;
  body?: B; // a JSON object, read and checked before the handler runs
  responses: R;
};
export type Handler<R, Q, B> = (input: { viewer: Viewer; req: Request; params: Record<string, string>; query: QueryOf<Q>; body: JsonOf<B> }) => Promise<Reply<R>>;
export type Op<
  R extends Record<number, ResponseSpec> = Record<number, ResponseSpec>,
  Q extends z.ZodObject | undefined = z.ZodObject | undefined,
  B extends z.ZodType | undefined = z.ZodType | undefined,
> = Meta<R, Q, B> & { handle: Handler<R, Q, B> };

type AnyReply = { status: number; body?: unknown };
// Any entry, as the dispatcher sees it: the per-entry typing is checked where the entry is declared.
export type AnyOp = Meta<Record<number, ResponseSpec>, z.ZodObject | undefined, z.ZodType | undefined> & { handle: (input: never) => Promise<AnyReply> };

// Declares an entry: op({...}).handle(async (input) => reply). Two calls on purpose: the first fixes
// the declared responses, so the handler's replies are checked against them with literal statuses
// (in one call, TypeScript widens `status: 200` to number before it knows the declared ones).
export function op<const R extends Record<number, ResponseSpec>, Q extends z.ZodObject | undefined = undefined, B extends z.ZodType | undefined = undefined>(
  meta: Meta<R, Q, B>,
): { handle: (h: Handler<R, Q, B>) => Op<R, Q, B> } {
  return { handle: (handle) => ({ ...meta, handle }) };
}

// The entries for a path, whatever the method, with its path parameters. `segments` are the decoded
// path after `prefix` (Next's catch-all param), so "a%2Fb" is one segment "a/b".
export function matchOps(ops: AnyOp[], prefix: string, segments: string[]): { ops: AnyOp[]; params: Record<string, string> } | null {
  const found: AnyOp[] = [];
  let params: Record<string, string> = {};
  for (const o of ops) {
    if (!o.path.startsWith(prefix + "/")) continue;
    const tpl = o.path.slice(prefix.length + 1).split("/");
    if (tpl.length !== segments.length) continue;
    const p: Record<string, string> = {};
    if (tpl.every((t, i) => (t.startsWith("{") ? ((p[t.slice(1, -1)] = segments[i]), true) : t === segments[i]))) {
      found.push(o);
      params = p;
    }
  }
  return found.length ? { ops: found, params } : null;
}

// Empty values count as absent; of repeated keys, the last wins.
function queryOf(req: Request): Record<string, string> {
  const entries = [...new URL(req.url).searchParams].filter(([, v]) => v !== "");
  return Object.fromEntries(entries);
}

const complaint = (error: z.ZodError) => z.prettifyError(error).replace(/\s+/g, " ").replace(/^✖ /, "");

async function jsonBody(req: Request, schema: z.ZodType): Promise<unknown> {
  const bytes = await readCapped(req, MAX_BODY_BYTES);
  if (!bytes) throw new InvalidRequestError("The request body is too large or was cut short");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidRequestError("The request body must be JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new InvalidRequestError(complaint(parsed.error));
  return parsed.data;
}

function send(entry: AnyOp, reply: AnyReply): Response {
  const declared = (entry.responses as Record<number, ResponseSpec>)[reply.status];
  if (!declared) {
    log.error({ operation: entry.operationId, status: reply.status }, "an operation answered a status it doesn't declare");
    return Response.json({ error: "internal error", code: "internal" }, { status: 500 });
  }
  // Types can't see formats and patterns (or a thrown error's body); check them wherever it's cheap to fail.
  if (process.env.NODE_ENV !== "production" && declared.schema) {
    const checked = declared.schema.safeParse(reply.body);
    if (!checked.success) {
      throw new Error(`${entry.operationId} answered ${reply.status} with a body that doesn't match its schema: ${z.prettifyError(checked.error)}`, {
        cause: checked.error,
      });
    }
  }
  if (reply.body === undefined) return new Response(null, { status: reply.status });
  return Response.json(reply.body, { status: reply.status });
}

// `prefix` is where the catch-all route is mounted (e.g. "/api/v1"); entry paths include it.
export function createDispatcher(ops: AnyOp[], prefix: string): (req: Request, segments: string[]) => Promise<Response> {
  return async (req, segments) => {
    const m = matchOps(ops, prefix, segments);
    if (!m) return Response.json(errorReply(new NotFoundError("no such endpoint")).body, { status: 404 });
    // Next answers HEAD by calling the GET export with the request as is; it drops the body itself.
    const method = req.method === "HEAD" ? "GET" : req.method;
    const entry = m.ops.find((o) => o.method === method);
    if (!entry) {
      const methods = m.ops.map((o) => o.method);
      const allow = (methods.includes("GET") ? [...methods, "HEAD"] : methods).sort().join(", ");
      return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: allow } });
    }
    let reply: AnyReply;
    try {
      // Who is asking comes first: a stranger learns nothing, not even that their parameters are wrong.
      const viewer = await requireViewer(req, "api");
      let query: Record<string, unknown> = {};
      if (entry.query) {
        const parsed = entry.query.safeParse(queryOf(req));
        if (!parsed.success) throw new InvalidRequestError(complaint(parsed.error));
        query = parsed.data;
      }
      const body = entry.body ? await jsonBody(req, entry.body) : undefined;
      reply = await entry.handle({ viewer, req, params: m.params, query, body } as never);
    } catch (e) {
      reply = errorReply(e);
      if (reply.status === 500) return Response.json(reply.body, { status: 500 }); // never declared, always allowed
    }
    return send(entry, reply);
  };
}
