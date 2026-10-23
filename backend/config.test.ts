import { afterEach, expect, test } from "vitest";
import { config } from "./config";

afterEach(() => {
  for (const k of ["FREUNDEBUCH_NOTIFY_AT", "FREUNDEBUCH_OIDC_ALLOW", "FREUNDEBUCH_SECRET", "PUBLIC_URL", "DATA_DIR"]) delete process.env[k];
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

test("oidc().allow splits on commas and trims", () => {
  expect(config.oidc().allow).toEqual([]);
  process.env.FREUNDEBUCH_OIDC_ALLOW = " marcel , anna,, ";
  expect(config.oidc().allow).toEqual(["marcel", "anna"]);
});

test("publicUrl has no trailing slash and is undefined when unset; secret likewise; dataDir defaults to /data", () => {
  expect(config.publicUrl()).toBeUndefined();
  expect(config.secret()).toBeUndefined();
  expect(config.dataDir()).toBe("/data");
  process.env.PUBLIC_URL = "https://freundebuch.example/";
  expect(config.publicUrl()).toBe("https://freundebuch.example");
});
