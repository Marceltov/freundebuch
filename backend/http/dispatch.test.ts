import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as z from "zod";
import { sign } from "../auth/tokens";
import { IDENTITY_COOKIE } from "../auth/session";
import { resetDbForTests } from "../db/testing";
import { AmbiguousError, ForbiddenError, InvalidInputError } from "../core/errors";
import { logsOf } from "../core/log";
import { resetSecretForTests } from "../core/secret";
import { userFromOidc } from "../core/users";
import { createDispatcher, matchOps, op, type AnyOp } from "./dispatch";

const E = { 400: { description: "bad" }, 401: { description: "no" }, 403: { description: "no" }, 409: { description: "two" } };
const ping = op({
  method: "GET",
  path: "/api/v1/things/{id}",
  operationId: "getThing",
  summary: "s",
  tags: [],
  auth: true,
  params: { id: z.string() },
  query: z.object({ n: z.coerce.number().int().optional() }),
  responses: { 200: { description: "ok", schema: z.object({ id: z.string(), n: z.number().optional(), uid: z.string() }) }, ...E },
}).handle(async ({ viewer, params, query }) => {
  if (params.id === "forbidden") throw new ForbiddenError();
  if (params.id === "ambiguous") throw new AmbiguousError("two matches");
  if (params.id === "invalid") throw new InvalidInputError("nope");
  if (params.id === "boom") throw new Error("SQLITE_CANTOPEN: /data/secret.db");
  return { status: 200, body: { id: params.id, n: query.n, uid: viewer.userId } };
});
const echo = op({
  method: "POST",
  path: "/api/v1/things",
  operationId: "postThing",
  summary: "s",
  tags: [],
  auth: true,
  params: {},
  body: z.object({ name: z.string() }),
  responses: { 201: { description: "ok", schema: z.object({ name: z.string() }) }, ...E },
}).handle(async ({ body }) => ({ status: 201, body: { name: body.name } }));
const dispatch = createDispatcher([ping, echo] as AnyOp[], "/api/v1");

const BASE = "http://localhost:3000";
let uid: string;
beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  resetSecretForTests();
  await resetDbForTests();
  uid = (await userFromOidc({ sub: "a", name: "Alice" })).userId;
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
});

const as = (user: string | null): Record<string, string> =>
  user ? { host: "localhost:3000", cookie: `${IDENTITY_COOKIE}=${sign("identity", { uid: user })}` } : { host: "localhost:3000" };
const get = (path: string, user: string | null = uid, method = "GET") =>
  dispatch(new Request(`${BASE}/api/v1${path}`, { method, headers: as(user) }), path.slice(1).split("?")[0].split("/"));
const post = (body: string, user: string | null = uid, headers: Record<string, string> = {}) =>
  dispatch(
    new Request(`${BASE}/api/v1/things`, { method: "POST", body, headers: { ...as(user), "content-type": "application/json", origin: BASE, ...headers } }),
    ["things"],
  );

test("matchOps binds path parameters and returns every method of a path", () => {
  const m = matchOps([ping, echo] as AnyOp[], "/api/v1", ["things", "a b"]);
  expect(m?.params).toEqual({ id: "a b" });
  expect(m?.ops).toHaveLength(1);
  expect(matchOps([ping] as AnyOp[], "/api/v1", ["other"])).toBeNull();
});

test("a handler gets the viewer and the parsed query", async () => {
  const res = await get("/things/x?n=3");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "x", n: 3, uid });
});

test("no sign-in is 401 before anything about the request is looked at", async () => {
  const res = await get("/things/x?n=oops", null);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Sign-in required", code: "unauthorized" });
  expect((await post("not json", null)).status).toBe(401);
});

test("a bad query or body is 400 invalid_request", async () => {
  const q = await get("/things/x?n=oops");
  expect(q.status).toBe(400);
  expect((await q.json()).code).toBe("invalid_request");
  for (const body of ["not json", "{}", '{"name":3}', "[]"]) {
    const res = await post(body);
    expect(res.status, body).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  }
  expect(await (await post('{"name":"x"}')).json()).toEqual({ name: "x" });
});

test("domain errors map to their status, with their code", async () => {
  for (const [id, status, code] of [
    ["forbidden", 403, "forbidden"],
    ["ambiguous", 409, "ambiguous"],
    ["invalid", 400, "invalid_input"],
  ] as const) {
    const res = await get(`/things/${id}`);
    expect([res.status, (await res.json()).code]).toEqual([status, code]);
  }
});

test("an unknown error is a logged 500 that says nothing of it", async () => {
  let res!: Response;
  const logs = await logsOf(async () => (res = await get("/things/boom")));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "internal error", code: "internal" });
  expect(logs).toMatchObject([{ level: "error", component: "http", msg: "request failed" }]);
});

test("an unknown path is 404 and a missing method 405 with Allow", async () => {
  const none = await dispatch(new Request(`${BASE}/api/v1/nothing`), ["nothing"]);
  expect([none.status, (await none.json()).code]).toEqual([404, "not_found"]);
  const wrong = await get("/things/x", uid, "DELETE");
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get("allow")).toBe("GET, HEAD");
});

test("an answer that does not match its declared schema fails loudly outside production", async () => {
  const bad = op({
    method: "GET",
    path: "/api/v1/bad",
    operationId: "bad",
    summary: "s",
    tags: [],
    auth: true,
    params: {},
    responses: { 200: { description: "ok", schema: z.object({ a: z.string() }) } },
  }).handle(async () => ({ status: 200, body: { a: 1 as unknown as string } }));
  const d = createDispatcher([bad] as AnyOp[], "/api/v1");
  await expect(d(new Request(`${BASE}/api/v1/bad`, { headers: as(uid) }), ["bad"])).rejects.toThrow(/doesn't match its schema/);
});
