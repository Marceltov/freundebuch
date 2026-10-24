import { afterEach, expect, test } from "vitest";
import { healthRoute, setDbProbe } from "./health";

afterEach(() => setDbProbe(() => undefined));

test("200 ok while the database answers, never cached", async () => {
  const res = await healthRoute();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok" });
});

test("503 unavailable when the database does not answer, and nothing of the error in the answer", async () => {
  setDbProbe(() => Promise.reject(new Error("SQLITE_CANTOPEN: /data/freundebuch.db")));
  const res = await healthRoute();
  expect(res.status).toBe(503);
  expect(await res.text()).toBe('{"status":"unavailable"}');
});
