import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetDbForTests } from "../db/testing";
import { resetSecretForTests } from "../core/secret";
import { e2eLoginRoute } from "./e2e";
import { viewerFromCookie } from "./session";

const login = () => e2eLoginRoute(new Request("http://localhost:3000/api/e2e/login?name=Erika"));

beforeEach(async () => {
  vi.stubEnv("FREUNDEBUCH_SECRET", "s".repeat(40));
  resetSecretForTests();
  await resetDbForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretForTests();
});

test("off unless FREUNDEBUCH_E2E=1: a 404 like any unknown endpoint", async () => {
  const res = await login();
  expect(res.status).toBe(404);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("never in production, even with FREUNDEBUCH_E2E=1", async () => {
  vi.stubEnv("FREUNDEBUCH_E2E", "1");
  vi.stubEnv("NODE_ENV", "production");
  expect((await login()).status).toBe(404);
});

test("with FREUNDEBUCH_E2E=1 outside production: an identity cookie for the named user, then the start page", async () => {
  vi.stubEnv("FREUNDEBUCH_E2E", "1");
  const res = await login();
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  const value = /fb_identity=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  expect(await viewerFromCookie(value)).not.toBeNull();
});
