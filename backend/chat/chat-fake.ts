// A stand-in for Claude in e2e runs (FREUNDEBUCH_E2E=1, never in a production build: config.e2e()), so the chat can be tested
// end to end without an API key or a bill. It knows six messages: "Notiz: …" files a conversation with the rest as its
// transcript about the person whose page the chat was opened on; "Tagebuch: …" files the rest as a private journal entry;
// "Erlebnis: …" files the rest as a session of the series "Hundeschule" (weekly) at "Pfotenglück";
// "Erledigt", in a chat opened on shared files, closes them (inbox done); a request for birthday wishes on a person's page
// ("…zum Geburtstag…") asks birthday_message for the links to "Alles Gute!"; "Fehlertest" fails like an unreachable API; anything else gets "Verstanden.". Tool results get "Erfasst.".
import Anthropic from "@anthropic-ai/sdk";
import type { ChatModel } from "./chat";

const reply = (content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage =>
  ({ id: "fake", type: "message", role: "assistant", model: "fake", usage: {}, stop_reason, content }) as unknown as Anthropic.Beta.BetaMessage;
const say = (text: string) => reply([{ type: "text", text, citations: null }], "end_turn");

export const fakeModel: ChatModel = {
  async create(p) {
    const last = p.messages[p.messages.length - 1];
    const situation = (p.system as Anthropic.Beta.BetaTextBlockParam[])[1].text;
    const one = situation.match(/\(fileId ([^)]+)\)/)?.[1];
    const several = situation.match(/\(fileIds (\[[^\]]+\])/)?.[1];
    const files: string[] = one ? [one] : several ? JSON.parse(several) : [];
    // Opened on a file, the user's words are the last block of their first message.
    const blocks = typeof last.content === "string" ? [] : (last.content ?? []);
    const words = typeof last.content === "string" ? last.content : blocks.findLast((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")?.text;
    if (files.length && words === "Erledigt" && p.messages.length === 1)
      return reply([{ type: "tool_use", id: "fake_done", name: "inbox", input: { action: "done", ids: files } }], "tool_use");
    if (typeof last.content !== "string") return say("Erfasst.");
    if (last.content === "Fehlertest") throw new Anthropic.APIConnectionError({ message: "the fake is down, as asked" });
    const note = last.content.match(/^Notiz:\s*(.+)$/s);
    const person = situation.match(/on the page of .+? \(([^)]+)\)/)?.[1];
    const day = situation.match(/Today is (\d{4}-\d{2}-\d{2})/)?.[1];
    const lived = last.content.match(/^Erlebnis:\s*(.+)$/s);
    if (lived && day)
      return reply(
        [
          {
            type: "tool_use",
            id: "fake_record",
            name: "record",
            input: {
              date: day,
              visibility: "shared",
              people: [],
              experiences: [{ kind: "Kurs", title: lived[1], place: "Pfotenglück", series: { name: "Hundeschule", rhythmDays: 7 } }],
            },
          },
        ],
        "tool_use",
      );
    if (/Geburtstag/.test(last.content) && person)
      return reply([{ type: "tool_use", id: "fake_wish", name: "birthday_message", input: { personId: person, text: "Alles Gute!" } }], "tool_use");
    const journal = last.content.match(/^Tagebuch:\s*(.+)$/s);
    if (journal && day)
      return reply(
        [{ type: "tool_use", id: "fake_record", name: "record", input: { date: day, visibility: "shared", people: [], journal: [{ text: journal[1] }] } }],
        "tool_use",
      );
    if (!note || !person || !day) return say("Verstanden.");
    return reply(
      [
        {
          type: "tool_use",
          id: "fake_record",
          name: "record",
          input: {
            date: day,
            transcript: note[1],
            visibility: "shared",
            people: [{ id: person }],
            conversations: [{ kind: "message", summary: note[1], present: [0] }],
          },
        },
      ],
      "tool_use",
    );
  },
};
