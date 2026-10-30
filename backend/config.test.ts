import { afterEach, expect, test, vi } from "vitest";
import { chatEnabled } from "./chat-route";
import { config } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of [
    "FREUNDEBUCH_NOTIFY_AT",
    "FREUNDEBUCH_OIDC_ALLOW",
    "FREUNDEBUCH_TRUST_PROXY",
    "FREUNDEBUCH_RATE_LIMIT",
    "FREUNDEBUCH_SECRET",
    "PUBLIC_URL",
    "DATA_DIR",
    "TZ",
  ])
    delete process.env[k];
});

test("notifyAt is 08:00 when unset or empty", () => {
  expect(config.notifyAt()).toBe("08:00");
  process.env.FREUNDEBUCH_NOTIFY_AT = "";
  expect(config.notifyAt()).toBe("08:00");
});

test("notifyAt takes HH:MM", () => {
  for (const v of ["00:00", "07:30", "19:05", "23:59"]) {
    process.env.FREUNDEBUCH_NOTIFY_AT = v;
    expect(config.notifyAt()).toBe(v);
  }
});

test("a notifyAt that is not HH:MM throws, naming the variable", () => {
  for (const v of ["8:00", "24:00", "12:60", "noon", "08:00:00"]) {
    process.env.FREUNDEBUCH_NOTIFY_AT = v;
    expect(() => config.notifyAt()).toThrow(/FREUNDEBUCH_NOTIFY_AT/);
  }
});

test("oidc().allow splits on commas, trims and lowercases; unset, empty or only commas means * (authentik decides)", () => {
  expect(config.oidc().allow).toEqual(["*"]);
  for (const v of ["", " , ,"]) {
    process.env.FREUNDEBUCH_OIDC_ALLOW = v;
    expect(config.oidc().allow).toEqual(["*"]);
  }
  process.env.FREUNDEBUCH_OIDC_ALLOW = " Marcel@X.de , @Y.de,, ";
  expect(config.oidc().allow).toEqual(["marcel@x.de", "@y.de"]);
});

test("trustProxy only for exactly 1; rateLimit defaults to 60", () => {
  expect(config.trustProxy()).toBe(false);
  process.env.FREUNDEBUCH_TRUST_PROXY = "true";
  expect(config.trustProxy()).toBe(false);
  process.env.FREUNDEBUCH_TRUST_PROXY = "1";
  expect(config.trustProxy()).toBe(true);
  expect(config.rateLimit()).toBe(60);
  process.env.FREUNDEBUCH_RATE_LIMIT = " 5 ";
  expect(config.rateLimit()).toBe(5);
  process.env.FREUNDEBUCH_RATE_LIMIT = "0";
  expect(config.rateLimit()).toBe(0);
  process.env.FREUNDEBUCH_RATE_LIMIT = "x";
  expect(config.rateLimit()).toBe(60);
});

test("publicUrl has no trailing slash and is undefined when unset; secret likewise; dataDir defaults to /data", () => {
  expect(config.publicUrl()).toBeUndefined();
  expect(config.secret()).toBeUndefined();
  expect(config.dataDir()).toBe("/data");
  process.env.PUBLIC_URL = "https://freundebuch.example/";
  expect(config.publicUrl()).toBe("https://freundebuch.example");
});

test("timeZone is TZ, Europe/Berlin when unset or empty, and an invalid one throws naming TZ", () => {
  expect(config.timeZone()).toBe("Europe/Berlin");
  process.env.TZ = "";
  expect(config.timeZone()).toBe("Europe/Berlin");
  process.env.TZ = "America/New_York";
  expect(config.timeZone()).toBe("America/New_York");
  for (const v of ["Mars/Base", "nonsense"]) {
    process.env.TZ = v;
    expect(() => config.timeZone()).toThrow(/TZ/);
  }
});

test("the chat: no key means off; the model and the daily limit have defaults", () => {
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", " ");
  expect(config.anthropicKey()).toBeUndefined();
  expect(chatEnabled()).toBe(false);
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_API_KEY", "sk-ant-x");
  expect(chatEnabled()).toBe(true);
  expect(config.anthropicModel()).toBe("claude-sonnet-5-5");
  expect(config.chatDailyLimit()).toBe(100);
  vi.stubEnv("FREUNDEBUCH_ANTHROPIC_MODEL", "claude-opus-5-5");
  vi.stubEnv("FREUNDEBUCH_CHAT_DAILY_LIMIT", "20");
  expect([config.anthropicModel(), config.chatDailyLimit()]).toEqual(["claude-opus-5-5", 20]);
  vi.stubEnv("FREUNDEBUCH_CHAT_DAILY_LIMIT", "lots");
  expect(config.chatDailyLimit()).toBe(100);
});

test(".env.example, compose.yaml and the configuration docs name every chat variable", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of [".env.example", "compose.yaml", "docs/self-hosting/configuration.md"]) {
    const text = await readFile(file, "utf8");
    for (const name of ["FREUNDEBUCH_ANTHROPIC_API_KEY", "FREUNDEBUCH_ANTHROPIC_MODEL", "FREUNDEBUCH_CHAT_DAILY_LIMIT"])
      expect(text, `${file} ${name}`).toContain(name);
  }
});
