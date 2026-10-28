// A stand-in for Claude in e2e runs (FREUNDEBUCH_E2E=1, never in a production build: config.e2e()), so the chat can be tested
// end to end without an API key or a bill. It knows four messages: "Notiz: …" files a conversation with the rest as its
// transcript about the person whose page the chat was opened on; "Erledigt", in a chat opened on a shared file, closes that
// file (inbox done); "Fehlertest" fails like an unreachable API; anything else gets "Verstanden.". Tool results get "Erfasst.".
import Anthropic from "@anthropic-ai/sdk";
import type { ChatModel } from "./chat";

const reply = (content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage =>
  ({ id: "fake", type: "message", role: "assistant", model: "fake", usage: {}, stop_reason, content }) as unknown as Anthropic.Beta.BetaMessage;
const say = (text: string) => reply([{ type: "text", text, citations: null }], "end_turn");

export const fakeModel: ChatModel = {
  async create(p) {
    const last = p.messages[p.messages.length - 1];
    const file = (p.system as Anthropic.Beta.BetaTextBlockParam[])[1].text.match(/\(fileId ([^)]+)\)/)?.[1];
    // Opened on a file, the user's words are the last block of their first message.
    const blocks = typeof last.content === "string" ? [] : (last.content ?? []);
    const words = typeof last.content === "string" ? last.content : blocks.findLast((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")?.text;
    if (file && words === "Erledigt" && p.messages.length === 1)
      return reply([{ type: "tool_use", id: "fake_done", name: "inbox", input: { action: "done", id: file } }], "tool_use");
    if (typeof last.content !== "string") return say("Erfasst.");
    if (last.content === "Fehlertest") throw new Anthropic.APIConnectionError({ message: "the fake is down, as asked" });
    const note = last.content.match(/^Notiz:\s*(.+)$/s);
    const situation = (p.system as Anthropic.Beta.BetaTextBlockParam[])[1].text;
    const person = situation.match(/on the page of .+? \(([^)]+)\)/)?.[1];
    const day = situation.match(/Today is (\d{4}-\d{2}-\d{2})/)?.[1];
    if (!note || !person || !day) return say("Verstanden.");
    return reply(
      [
        {
          type: "tool_use",
          id: "fake_record",
          name: "record_conversation",
          input: { date: day, kind: "message", summary: note[1], transcript: note[1], visibility: "shared", people: [{ id: person, present: true }] },
        },
      ],
      "tool_use",
    );
  },
};
