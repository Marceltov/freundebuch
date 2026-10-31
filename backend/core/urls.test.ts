import { expect, test } from "vitest";
import { absoluteUrls, itemPath, personPath } from "./urls";

test("absoluteUrls prefixes every url that is a path, however deep, and nothing else", () => {
  const body = { url: "/p/1", id: "/p/1", people: [{ url: itemPath(personPath("2"), "facts", "f") }], other: { url: "https://x.example/" }, n: null };
  expect(absoluteUrls("https://fb.example", body)).toEqual({
    url: "https://fb.example/p/1",
    id: "/p/1",
    people: [{ url: "https://fb.example/p/2#facts-f" }],
    other: { url: "https://x.example/" },
    n: null,
  });
  expect(absoluteUrls("https://fb.example", undefined)).toBeUndefined();
});
