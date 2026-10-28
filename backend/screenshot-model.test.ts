import Anthropic from "@anthropic-ai/sdk";
import { expect, test } from "vitest";
import { createLogger } from "./log";
import { anthropicScreenshotModel } from "./screenshot-model";

const input = { bytes: new Uint8Array([1]), type: "image/webp", people: [], today: "2026-10-28" };
const good = { kind: "post", platform: "Instagram", text: "Urlaub", category: "travel", happenedOn: null, sensitive: false, situation: false, checkAfterDays: null, role: null, people: [] };

// A model whose client answers `reply` (or throws it), and the lines it logged.
function withClient(reply: unknown) {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ write: (l: string) => void lines.push(JSON.parse(l)) }, "debug");
  const create = async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const model = anthropicScreenshotModel("key", "claude-sonnet-5-5", { client: { messages: { create } } as never, log });
  return { model, lines };
}
const message = (content: unknown[], stop_reason = "tool_use") => ({ content, stop_reason });

test("a usable answer is the reading, and nothing is logged", async () => {
  const { model, lines } = withClient(message([{ type: "tool_use", id: "t", name: "report", input: good }]));
  expect(await model.read(input)).toMatchObject({ kind: "post", text: "Urlaub" });
  expect(lines).toEqual([]);
});

test("an API error is no reading, and says why", async () => {
  const err = Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "image too large" } }, "image too large", new Headers());
  const { model, lines } = withClient(err);
  expect(await model.read(input)).toBeNull();
  expect(lines).toEqual([expect.objectContaining({ level: "warn", msg: "the screenshot model call failed", status: 400, error: expect.stringContaining("image too large") })]);
});

test("an answer without the report, or one that doesn't fit, is no reading, and says why", async () => {
  const cut = withClient(message([{ type: "text", text: "…" }], "max_tokens"));
  expect(await cut.model.read(input)).toBeNull();
  expect(cut.lines).toEqual([expect.objectContaining({ level: "warn", msg: "the screenshot model gave no report", stopReason: "max_tokens" })]);
  const odd = withClient(message([{ type: "tool_use", id: "t", name: "report", input: { ...good, category: "chat" } }]));
  expect(await odd.model.read(input)).toBeNull();
  expect(odd.lines).toEqual([expect.objectContaining({ level: "warn", msg: "the screenshot model's report doesn't fit", issues: [expect.stringContaining("category")] })]);
});
