import { afterEach, beforeEach, expect, test } from "vitest";
import { authFailed, authWait, clientIp, resetRateLimitsForTests } from "./limits";
import { logsOf } from "../core/log";

beforeEach(() => {
  resetRateLimitsForTests();
  process.env.FREUNDEBUCH_RATE_LIMIT = "3";
  delete process.env.FREUNDEBUCH_TRUST_PROXY;
});
afterEach(() => {
  delete process.env.FREUNDEBUCH_RATE_LIMIT;
  delete process.env.FREUNDEBUCH_TRUST_PROXY;
});

test("only failures count; the 4th check in a minute waits 1..60 seconds; allowed again after the window", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) expect(authWait("a", t)).toBeNull(); // checking alone counts nothing
  for (let i = 0; i < 3; i++) authFailed("a", t);
  const wait = authWait("a", t + 1000);
  expect(wait).toBeGreaterThanOrEqual(1);
  expect(wait).toBeLessThanOrEqual(60);
  expect(authWait("a", t + 60_000)).toBeNull();
});

test("separate IPs have separate buckets", () => {
  for (let i = 0; i < 3; i++) authFailed("a", 1);
  expect(authWait("a", 1)).not.toBeNull();
  expect(authWait("b", 1)).toBeNull();
});

test("FREUNDEBUCH_RATE_LIMIT=0 never limits", () => {
  process.env.FREUNDEBUCH_RATE_LIMIT = "0";
  for (let i = 0; i < 500; i++) authFailed("a", 1);
  expect(authWait("a", 1)).toBeNull();
});

test("default is 60 per minute; garbage means the default", () => {
  for (const v of [undefined, "", "lots"]) {
    resetRateLimitsForTests();
    if (v === undefined) delete process.env.FREUNDEBUCH_RATE_LIMIT;
    else process.env.FREUNDEBUCH_RATE_LIMIT = v;
    for (let i = 0; i < 59; i++) authFailed("a", 1);
    expect(authWait("a", 1)).toBeNull();
    authFailed("a", 1);
    expect(authWait("a", 1)).not.toBeNull();
  }
});

test("clientIp trusts x-forwarded-for only with FREUNDEBUCH_TRUST_PROXY=1, and takes the last entry", () => {
  // The client sent 6.6.6.6; an appending proxy added the address it saw, 1.2.3.4.
  const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
  expect(clientIp(h)).toBe("direct");
  process.env.FREUNDEBUCH_TRUST_PROXY = "1";
  expect(clientIp(h)).toBe("1.2.3.4");
  expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8" }))).toBe("5.6.7.8");
  expect(clientIp(new Headers())).toBe("direct");
});

test("an expired entry doesn't limit, even before the next prune", () => {
  const t = 1_000_000;
  authFailed("z", t); // prunes at t
  for (let i = 0; i < 3; i++) authFailed("a", t + 30_000);
  authFailed("z", t + 60_000); // prunes again; a is still live
  expect(authWait("a", t + 89_000)).not.toBeNull();
  expect(authWait("a", t + 95_000)).toBeNull(); // a expired at t + 90_000, next prune only at t + 120_000
});

test("a limit reached is a debug line with its kind, never the IP", async () => {
  const logs = await logsOf(() => {
    for (let i = 0; i < 3; i++) authFailed("203.0.113.9", 0);
    authWait("203.0.113.9", 0);
  });
  expect(logs).toEqual([{ level: "debug", component: "limits", msg: "rate limit reached", kind: "sign-in" }]);
});
