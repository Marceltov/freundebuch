import { afterEach, expect, test } from "vitest";
import { addDays, ageOn, daysBetween, nextOccurrence, today } from "./dates";
import { InvalidInputError } from "./errors";

const tz = process.env.TZ;
afterEach(() => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

test("today is the date in TZ, not in UTC", () => {
  process.env.TZ = "Europe/Berlin";
  expect(today(Date.parse("2026-10-23T22:30:00Z"))).toBe("2026-10-24");
  expect(today(Date.parse("2026-10-23T21:30:00Z"))).toBe("2026-10-23");
  process.env.TZ = "UTC";
  expect(today(Date.parse("2026-10-23T22:30:00Z"))).toBe("2026-10-23");
});

test("today uses Europe/Berlin when TZ is unset", () => {
  delete process.env.TZ;
  expect(today(Date.parse("2026-10-23T22:30:00Z"))).toBe("2026-10-24");
});

test("daysBetween counts whole calendar days, across year ends and leap days", () => {
  expect(daysBetween("2026-10-20", "2026-10-23")).toBe(3);
  expect(daysBetween("2026-10-23", "2026-10-20")).toBe(-3);
  expect(daysBetween("2026-12-20", "2027-01-03")).toBe(14);
  expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
});

test("nextOccurrence: today counts, the next one may be next year", () => {
  expect(nextOccurrence("--10-24", "2026-10-24")).toBe("2026-10-24");
  expect(nextOccurrence("--10-24", "2026-10-25")).toBe("2027-10-24");
  expect(nextOccurrence("1990-10-24", "2026-10-23")).toBe("2026-10-24");
});

test("a birthday on 3 Jan is in 14 days on 20 Dec", () => {
  const next = nextOccurrence("--01-03", "2026-12-20");
  expect(next).toBe("2027-01-03");
  expect(daysBetween("2026-12-20", next)).toBe(14);
});

test("29 Feb falls on 28 Feb in a non-leap year and on 29 Feb in a leap year", () => {
  expect(nextOccurrence("--02-29", "2027-01-10")).toBe("2027-02-28");
  expect(nextOccurrence("2000-02-29", "2027-01-10")).toBe("2027-02-28");
  expect(nextOccurrence("--02-29", "2028-01-10")).toBe("2028-02-29");
  expect(nextOccurrence("--02-29", "2027-03-01")).toBe("2028-02-29");
});

test("ageOn: none without a year; the birthday itself counts; 29 Feb counts on 28 Feb", () => {
  expect(ageOn("--10-24", "2026-10-24")).toBeNull();
  expect(ageOn("1990-10-24", "2026-10-23")).toBe(35);
  expect(ageOn("1990-10-24", "2026-10-24")).toBe(36);
  expect(ageOn("2000-02-29", "2027-02-27")).toBe(26);
  expect(ageOn("2000-02-29", "2027-02-28")).toBe(27);
  expect(ageOn("2030-01-01", "2026-10-24")).toBeNull();
});

test("impossible dates are rejected", () => {
  for (const bad of ["2026-13-45", "2026-02-29", "--02-31", "--13-01", "24.10.2026", ""]) {
    expect(() => nextOccurrence(bad, "2026-10-23"), bad).toThrow(InvalidInputError);
    expect(() => daysBetween(bad, "2026-10-23"), bad).toThrow(InvalidInputError);
    expect(() => daysBetween("2026-10-23", bad), bad).toThrow(InvalidInputError);
    expect(() => ageOn(bad, "2026-10-23"), bad).toThrow(InvalidInputError);
  }
  expect(() => nextOccurrence("--10-24", "2026-02-30")).toThrow(InvalidInputError);
  expect(() => nextOccurrence("--10-24", "--10-24")).toThrow(InvalidInputError);
});

test("addDays crosses months, years and leap days", () => {
  expect(addDays("2026-10-26", 42)).toBe("2026-12-07");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
});
