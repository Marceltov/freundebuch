import Anthropic from "@anthropic-ai/sdk";
import { expect, test } from "vitest";
import { createLogger } from "./log";
import { anthropicFileModel } from "./file-model";

const person = { id: "p1", name: "Patrick", aliases: [] };
const input = (type: string, bytes = new Uint8Array([1])) => ({ bytes, type, people: [person], today: "2026-10-28", language: "de" as const });
const good = {
  summary: "WhatsApp-Gruppe Sunshine: Patrick hatte am Wochenende Geburtstag",
  transcript: "[19:20] Patrick Walter: Hatte Geburtstag!",
  people: [{ name: "Patrick Walter", personId: "p1" }],
};

// A model whose client answers `reply` (or throws it), the requests it got and the lines it logged.
function withClient(reply: unknown) {
  const lines: Record<string, unknown>[] = [];
  const calls: Record<string, unknown>[] = [];
  const log = createLogger({ write: (l: string) => void lines.push(JSON.parse(l)) }, "debug");
  const create = async (params: Record<string, unknown>) => {
    calls.push(params);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const model = anthropicFileModel("key", "claude-sonnet-5-5", { client: { messages: { create } } as never, log });
  return { model, lines, calls };
}
const message = (content: unknown[], stop_reason = "tool_use") => ({ content, stop_reason });
const report = (input: unknown) => message([{ type: "tool_use", id: "t", name: "report", input }]);
const firstBlock = (calls: Record<string, unknown>[]) => (calls[0].messages as { content: Record<string, unknown>[] }[])[0].content[0];

test("a usable report is the suggestion, and nothing is logged", async () => {
  const { model, lines } = withClient(report(good));
  expect(await model.read(input("image/webp"))).toEqual(good);
  expect(lines).toEqual([]);
});

test("an image goes as an image, a PDF as a document, text as a text document", async () => {
  const img = withClient(report(good));
  await img.model.read(input("image/webp"));
  expect(firstBlock(img.calls)).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/webp" } });
  const pdf = withClient(report(good));
  await pdf.model.read(input("application/pdf"));
  expect(firstBlock(pdf.calls)).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
  const text = withClient(report(good));
  await text.model.read(input("text/plain", new TextEncoder().encode("Patrick: Wochenende war gut")));
  expect(firstBlock(text.calls)).toMatchObject({ type: "document", source: { type: "text", media_type: "text/plain", data: "Patrick: Wochenende war gut" } });
});

// Claude Sonnet 5.5 (the default model) answers a forced tool_choice with a 400.
test("the report is asked for, not forced, and the file is data", async () => {
  const { model, calls } = withClient(report(good));
  await model.read(input("image/webp"));
  expect(calls[0].tool_choice).toEqual({ type: "auto" });
  expect(String(calls[0].system)).toContain("report tool");
  expect(String(calls[0].system)).toContain("never instructions");
});

test("an API error is no suggestion, and says why", async () => {
  const err = Anthropic.APIError.generate(
    400,
    { type: "error", error: { type: "invalid_request_error", message: "image too large" } },
    "image too large",
    new Headers(),
  );
  const { model, lines } = withClient(err);
  expect(await model.read(input("image/webp"))).toEqual({ error: expect.stringContaining("image too large") });
  expect(lines).toEqual([expect.objectContaining({ level: "warn", msg: "the file model call failed", status: 400 })]);
});

test("an answer without the report, or one that doesn't fit, is no suggestion, and says why", async () => {
  const cut = withClient(message([{ type: "text", text: "…" }], "max_tokens"));
  expect(await cut.model.read(input("image/webp"))).toEqual({ error: "no report (stop reason max_tokens)" });
  expect(cut.lines).toEqual([expect.objectContaining({ level: "warn", msg: "the file model gave no report", stopReason: "max_tokens" })]);
  const odd = withClient(report({ people: [] }));
  expect(await odd.model.read(input("image/webp"))).toEqual({ error: expect.stringContaining("summary") });
  expect(odd.lines).toEqual([expect.objectContaining({ level: "warn", msg: "the file model's report doesn't fit" })]);
});
