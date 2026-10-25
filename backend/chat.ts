// The in-app chat ("Erzählen"): the user's own messages go to Claude with the tools of tools.ts, and every tool call runs as
// that user, so Claude sees nothing the user couldn't read in the app. A manual tool loop over the Claude API, at most
// MAX_ROUNDS requests per message; the conversation itself lives on the user's device and arrives whole with every message.
// Claude is behind ChatModel, so tests (and e2e, chat-fake.ts) can stand in for it.
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod";
import { config } from "./config";
import { getConversation } from "./conversations";
import { db } from "./db";
import { today } from "./dates";
import { FreundebuchError } from "./errors";
import { logger } from "./log";
import { INSTRUCTIONS } from "./mcp";
import { getPerson } from "./people";
import { TOOLS, toolByName } from "./tools";
import type { Viewer } from "./types";

const log = logger("chat");

export const MAX_ROUNDS = 8;
export const MAX_TURNS = 40;

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatContext = { personId?: string; conversationId?: string };
/** Something a tool call filed or looked up, for the link chips under the reply. */
export type ChatLink = { kind: "person" | "conversation" | "group"; id: string; name?: string; date?: string; url: string };
export type ChatCode = "chat_refused" | "chat_too_long" | "chat_limit" | "chat_unavailable";
export type ChatReply = { reply: string; links: ChatLink[]; filed: boolean } | { code: ChatCode };

export interface ChatModel {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

/** Claude through the API key. A declined request is re-run on a fallback model by the API itself ("default" routing). */
export function anthropicModel(apiKey: string): ChatModel {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return { create: (params) => client.beta.messages.create(params) };
}

// The stable part of the system prompt: the MCP instructions plus what differs in the app. It is its own cached block; what
// changes per request follows it.
const CHAT_RULES = `
You are talking to the user inside the freundebuch web app, on their phone. Answer in German, briefly and warmly, in plain text without Markdown headings.
Links to what you filed or looked up appear as buttons under your reply, so don't write URLs.
When the user asks about someone, look them up with find_person and briefing before answering; answer only from what the tools return.`;

const TOOL_DEFS: Anthropic.Beta.BetaToolUnion[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: z.toJSONSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
}));

/** Counts this message against the user's daily limit; false when it is used up. */
async function spend(v: Viewer, day: string): Promise<boolean> {
  const d = await db();
  const row = await d.selectFrom("chat_usage").select("count").where("user_id", "=", v.userId).where("day", "=", day).executeTakeFirst();
  if ((row?.count ?? 0) >= config.chatDailyLimit()) return false;
  await d
    .insertInto("chat_usage")
    .values({ user_id: v.userId, day, count: 1 })
    .onConflict((oc) => oc.columns(["user_id", "day"]).doUpdateSet((eb) => ({ count: eb("chat_usage.count", "+", 1) })))
    .execute();
  return true;
}

async function situation(v: Viewer, context: ChatContext, day: string): Promise<string> {
  const me = await getPerson(v, v.personId).catch(() => null);
  const lines = [`Today is ${day}.`, me ? `The user is ${me.name} (person id ${me.id}).` : ""];
  if (context.personId) {
    const p = await getPerson(v, context.personId).catch(() => null);
    if (p) lines.push(`The user opened the chat on the page of ${p.name} (${p.id}); "they" or an unnamed person likely means them.`);
  } else if (context.conversationId) {
    const c = await getConversation(v, context.conversationId).catch(() => null);
    if (c) lines.push(`The user opened the chat on the conversation of ${c.date} (${c.id}) with ${c.participants.map((p) => p.name).join(", ")}.`);
  }
  return lines.filter(Boolean).join("\n");
}

// What a tool's result adds to the link chips.
function linksOf(name: string, input: unknown, out: Record<string, unknown>): ChatLink[] {
  if (name === "record_conversation") {
    const r = out as { conversationId: string; url: string; people: { id: string; name: string; url: string }[] };
    const date = (input as { date?: string }).date;
    return [{ kind: "conversation", id: r.conversationId, date, url: r.url }, ...r.people.map((p) => ({ kind: "person" as const, id: p.id, name: p.name, url: p.url }))];
  }
  if (name === "briefing") {
    const p = (out as { person: { id: string; name: string; url: string } }).person;
    return [{ kind: "person", id: p.id, name: p.name, url: p.url }];
  }
  if (name === "relate" && typeof out.name === "string" && typeof out.id === "string" && typeof out.url === "string")
    return [{ kind: "group", id: out.id, name: out.name, url: out.url }];
  return [];
}

/** One message of the in-app chat: the whole conversation so far (the last turn is the user's), as `v`, on `model`. */
export async function chat(v: Viewer, turns: ChatTurn[], context: ChatContext, model: ChatModel, now = Date.now()): Promise<ChatReply> {
  const day = today(now);
  if (!(await spend(v, day))) return { code: "chat_limit" };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS + "\n" + CHAT_RULES, cache_control: { type: "ephemeral" } },
    { type: "text", text: await situation(v, context, day) },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.slice(-MAX_TURNS).map((t) => ({ role: t.role, content: t.content }));
  const links = new Map<string, ChatLink>();
  let filed = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await model.create({
        model: config.anthropicModel(),
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system,
        tools: TOOL_DEFS,
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        log.warn({ status: e.status }, "the Claude API failed");
        return { code: "chat_unavailable" };
      }
      throw e;
    }
    if (response.stop_reason === "refusal") return { code: "chat_refused" };
    if (response.stop_reason === "max_tokens") return { code: "chat_too_long" };

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return reply ? { reply, links: [...links.values()], filed } : { code: "chat_refused" };
    }

    // The whole assistant turn goes back unchanged (thinking blocks included), then every tool's result in one user message.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = toolByName(use.name);
      try {
        if (!tool) throw new FreundebuchError("not_found", `No tool named ${use.name}`);
        const out = await tool.run(v, use.input);
        if (!tool.annotations.readOnlyHint) filed = true;
        for (const l of linksOf(use.name, use.input, out)) links.set(l.url, l);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
      } catch (e) {
        if (!(e instanceof FreundebuchError)) log.error({ err: e, tool: use.name }, "tool failed");
        results.push({ type: "tool_result", tool_use_id: use.id, content: e instanceof FreundebuchError ? e.message : "internal error", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { code: "chat_too_long" };
}
