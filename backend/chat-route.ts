// POST /api/chat: the in-app chat, for the web app only. The signed-in browser's own identity cookie (same-origin, as for the
// REST API); an access token is refused, so scripts and Claude keep using REST and MCP. Not in the REST table or OpenAPI.
// Without an API key (and outside e2e) there is no chat: 404, and the app shows no button.
import { NotFoundError } from "./errors";
import * as z from "zod";
import { viewerFromRequest } from "./auth/session";
import { anthropicModel, chat, MAX_TURNS, type ChatModel } from "./chat";
import { fakeModel } from "./chat-fake";
import { config } from "./config";
import { readCapped } from "./http/request";
import { transcriber } from "./transcribe";

const MAX_CHARS = 200_000;
// All turns of one message together: a long ramble fits, a runaway history doesn't (each tool round resends it).
export const MAX_TOTAL_CHARS = 250_000;
const Body = z.object({
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_CHARS), filed: z.boolean().optional() }))
    .min(1)
    .max(MAX_TURNS)
    .refine((t) => t[t.length - 1].role === "user", "the last turn must be the user's")
    .refine((t) => t.reduce((n, x) => n + x.content.length, 0) <= MAX_TOTAL_CHARS, `at most ${MAX_TOTAL_CHARS} characters in all`),
  context: z
    .object({
      personId: z.string().optional(),
      conversationId: z.string().optional(),
      rambleId: z.string().optional(),
      fileId: z.string().optional(),
      fileIds: z
        .array(z.string())
        .transform((ids) => ids.slice(0, 50))
        .optional()
        .describe("At most 50 go along; any more are left out, not refused"),
    })
    .optional(),
});

let override: ChatModel | null = null;
/** Tests stand in for Claude here; null goes back to the configured model. */
export const setChatModelForTests = (m: ChatModel | null) => {
  override = m;
};

function model(): ChatModel | null {
  if (override) return override;
  const key = config.anthropicKey();
  if (key) return anthropicModel(key);
  return config.e2e() ? fakeModel : null;
}

/** Whether the app offers the chat: an API key is set, or e2e runs with the stand-in. */
export const chatEnabled = (): boolean => !!config.anthropicKey() || config.e2e();

const STATUS = { chat_limit: 429, chat_unavailable: 502, chat_refused: 200, chat_too_long: 200 } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function chatRoute(req: Request): Promise<Response> {
  const m = model();
  if (!m) return json({ error: "not found", code: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (req.headers.has("authorization")) return json({ error: "the chat is for the web app", code: "unauthorized" }, 401);
  const v = await viewerFromRequest(req, "api");
  if (!v) return json({ error: "sign-in required", code: "unauthorized" }, 401);
  const bytes = await readCapped(req, 4 * MAX_TOTAL_CHARS);
  if (!bytes) return json({ error: "The conversation is too long", code: "invalid_request" }, 413);
  let parsed: z.infer<typeof Body>;
  try {
    const r = Body.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!r.success) return json({ error: z.prettifyError(r.error), code: "invalid_request" }, 400);
    parsed = r.data;
  } catch {
    return json({ error: "The request body must be JSON", code: "invalid_request" }, 400);
  }
  let reply: Awaited<ReturnType<typeof chat>>;
  try {
    reply = await chat(v, parsed.turns, parsed.context ?? {}, m);
  } catch (e) {
    // The page it was opened on (a file that is gone, or someone else's) doesn't exist for the caller.
    if (e instanceof NotFoundError) return json({ error: e.message, code: "not_found" }, 404);
    throw e;
  }
  return "code" in reply ? json(reply, STATUS[reply.code]) : json(reply);
}

/** Whether Erzählen offers speaking a message: the chat is on and a transcription server is set up (or e2e runs). */
export const voiceEnabled = (): boolean => chatEnabled() && !!transcriber();

/** The longest spoken message taken: a few minutes of Opus or AAC from the browser is well under this. */
const MAX_VOICE = 15 * 1024 * 1024;

// POST /api/chat/voice: a message spoken into Erzählen (the body, as the browser recorded it), turned into its words by the
// household's own Whisper and handed back, for the app to send as the user's message. The recording is never stored: only
// its words are kept, as the ramble they become. Same caller rules as the chat.
export async function voiceRoute(req: Request): Promise<Response> {
  const t = model() ? transcriber() : null;
  if (!t) return json({ error: "not found", code: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (req.headers.has("authorization")) return json({ error: "the chat is for the web app", code: "unauthorized" }, 401);
  const v = await viewerFromRequest(req, "api");
  if (!v) return json({ error: "sign-in required", code: "unauthorized" }, 401);
  const bytes = await readCapped(req, MAX_VOICE);
  if (!bytes) return json({ error: "The recording is too long", code: "voice_too_long" }, 413);
  if (!bytes.byteLength) return json({ error: "The recording is empty", code: "voice_empty" }, 400);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("audio/")) return json({ error: "Send the recording as audio/*", code: "invalid_request" }, 400);
  const said = await t.transcribe(bytes, type);
  if ("error" in said) return json({ error: said.error, code: "voice_unavailable" }, 502);
  return json({ text: said.text });
}
