import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { shareLink, ShareButton } from "./ShareButton";

const url = "https://freundebuch.example/p/1";

test("with a share sheet, the link goes there; closing it is no failure", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  expect(await shareLink({ share, clipboard: { writeText: vi.fn() } }, url, "Anna")).toBe("shared");
  expect(share).toHaveBeenCalledWith({ title: "Anna", url });
  const closed = vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" }));
  expect(await shareLink({ share: closed, clipboard: { writeText: vi.fn() } }, url, "Anna")).toBe("idle");
});

test("without one, or when it fails, the link is copied", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  expect(await shareLink({ clipboard: { writeText } }, url, "Anna")).toBe("copied");
  expect(writeText).toHaveBeenCalledWith(url);
  const broken = vi.fn().mockRejectedValue(new Error("not allowed"));
  expect(await shareLink({ share: broken, clipboard: { writeText } }, url, "Anna")).toBe("copied");
  expect(await shareLink({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } }, url, "Anna")).toBe("failed");
});

test("the button says what it does", () => {
  expect(renderToStaticMarkup(<ShareButton path="/p/1" title="Anna" />)).toContain('aria-label="Link teilen"');
});
