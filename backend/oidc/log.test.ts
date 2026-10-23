import { afterEach, beforeEach, expect, test } from "vitest";
import { logTo } from "../log";
import { logFailure } from "./log";

let lines: string[];
let restore: () => void;
beforeEach(() => {
  lines = [];
  restore = logTo((l) => void lines.push(l));
});
afterEach(() => restore());
const entry = () => {
  expect(lines).toHaveLength(1);
  const { time, ...rest } = JSON.parse(lines[0]);
  expect(typeof time).toBe("string");
  return rest;
};

test("one warn line on the oidc logger: the reason as msg, each detail as a field", () => {
  logFailure("token request rejected", { status: 400, error: "invalid_grant" });
  expect(entry()).toEqual({ level: "warn", component: "oidc", msg: "token request rejected", status: 400, error: "invalid_grant" });
});

test("without detail, just the reason", () => {
  logFailure("state mismatch or missing sign-in cookie");
  expect(entry()).toEqual({ level: "warn", component: "oidc", msg: "state mismatch or missing sign-in cookie" });
});

test("a value can't break the line or fake another one", () => {
  logFailure("discovery failed", { error: 'x"\n\roidc: forged \u2028\u0000\u001b[31m' });
  expect(lines[0].slice(0, -1)).not.toMatch(/[\n\r\u2028]/u);
  expect(entry().error).toBe('x"oidc: forged [31m');
});

test("each value is capped at 200 characters", () => {
  logFailure("discovery failed", { error: "a".repeat(500) });
  expect(entry().error).toBe("a".repeat(200));
});

test("never throws, even when the log output does", () => {
  restore();
  restore = logTo(() => {
    throw new Error("log down");
  });
  expect(() => logFailure("discovery failed", { error: "x" })).not.toThrow();
});
