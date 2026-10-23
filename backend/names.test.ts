import { expect, test } from "vitest";
import { norm } from "./names";

test("norm folds umlauts, case and whitespace", () => {
  expect(norm("Jürgen")).toBe("juergen");
  expect(norm("Jürgen")).toBe(norm("Juergen"));
  expect(norm("JÜRGEN ")).toBe(norm("Juergen"));
  expect(norm("Straße")).toBe("strasse");
  expect(norm("  Anna   Maria ")).toBe("anna maria");
});

test("norm strips other diacritics", () => {
  expect(norm("José Müller-Çelik")).toBe("jose mueller-celik");
});
