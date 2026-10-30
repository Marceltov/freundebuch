import { afterEach, beforeEach, expect, test } from "vitest";
import { config } from "../config";
import { allowed, missingVars, nameFrom, provider } from "./config";

const VARS = ["ISSUER", "CLIENT_ID", "CLIENT_SECRET"].map((n) => `FREUNDEBUCH_OIDC_${n}`);
const setAll = () => {
  process.env.FREUNDEBUCH_OIDC_ISSUER = "https://idp.example";
  process.env.FREUNDEBUCH_OIDC_CLIENT_ID = "id";
  process.env.FREUNDEBUCH_OIDC_CLIENT_SECRET = "secret";
};
const clear = () =>
  Object.keys(process.env)
    .filter((k) => k.startsWith("FREUNDEBUCH_OIDC_"))
    .forEach((k) => delete process.env[k]);
beforeEach(clear);
afterEach(clear);

test("the provider needs issuer, client id and client secret; ALLOW is optional", () => {
  expect(provider()).toBeUndefined();
  expect(missingVars()).toEqual(VARS);
  setAll();
  expect(provider()).toEqual({ issuer: "https://idp.example", clientId: "id", clientSecret: "secret", allow: ["*"] });
  expect(missingVars()).toEqual([]);
  for (const v of VARS) {
    setAll();
    process.env[v] = "";
    expect(provider()).toBeUndefined();
    expect(missingVars()).toEqual([v]);
  }
});

test("ALLOW, when set, restricts", () => {
  setAll();
  process.env.FREUNDEBUCH_OIDC_ALLOW = " A@X.com, @Y.com ";
  expect(provider()!.allow).toEqual(["a@x.com", "@y.com"]);
});

const allow = (list: string, claims: { email?: string; email_verified?: boolean }) => {
  process.env.FREUNDEBUCH_OIDC_ALLOW = list;
  return allowed({ allow: config.oidc().allow }, claims);
};

test("allowed: exact address, case-insensitive, verified only", () => {
  expect(allow("a@x.com", { email: "A@X.com", email_verified: true })).toBe(true);
  expect(allow("a@x.com", { email: "b@x.com", email_verified: true })).toBe(false);
  expect(allow("a@x.com", { email: "a@x.com" })).toBe(false);
  expect(allow("a@x.com", { email: "a@x.com", email_verified: false })).toBe(false);
  expect(allow("a@x.com", {})).toBe(false);
});

test("allowed: @domain matches that domain only", () => {
  const ok = { email_verified: true };
  expect(allow("@x.com", { ...ok, email: "a@x.com" })).toBe(true);
  for (const email of ["a@sub.x.com", "a@x.com.evil", "ax.com"]) expect(allow("@x.com", { ...ok, email })).toBe(false);
  expect(allow("@x.com", { email: "a@x.com" })).toBe(false);
});

test("allowed: * (the default) allows anyone, even without an email", () => {
  expect(allow("*", {})).toBe(true);
  expect(allow("", {})).toBe(true);
  expect(allow("*", { email: "a@x.com" })).toBe(true);
});

test("allowed: an empty list allows nobody", () => {
  expect(allowed({ allow: [] }, { email: "a@x.com", email_verified: true })).toBe(false);
});

test("nameFrom: name, then preferred_username, then email; trimmed", () => {
  expect(nameFrom({ name: " Ann ", preferred_username: "ann", email: "a@x" })).toBe("Ann");
  expect(nameFrom({ name: "  ", preferred_username: "ann", email: "a@x" })).toBe("ann");
  expect(nameFrom({ email: "a@x" })).toBe("a@x");
  expect(nameFrom({ name: 5, preferred_username: {}, email: "a@x" })).toBe("a@x");
  expect(nameFrom({})).toBeUndefined();
  expect(nameFrom({ Name: "x" })).toBeUndefined();
});

test("nameFrom: control and text-direction override characters become spaces; a claim of only those is skipped", () => {
  expect(nameFrom({ name: "An\u202en" })).toBe("An n");
  expect(nameFrom({ name: "\u202e\u2028", email: "a@x" })).toBe("a@x");
});
