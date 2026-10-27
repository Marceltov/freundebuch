// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, the tools of tools.ts over the same domain functions the REST API uses. Every call
// carries the user's own access token, and every tool acts as that viewer: privacy is decided in the domain, never by Claude.
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { bearerOf, viewerFromRequest } from "./auth/session";
import { verify } from "./auth/tokens";
import { FreundebuchError } from "./errors";
import { logger } from "./log";
import { TOOLS } from "./tools";
import type { Viewer } from "./types";
import { absoluteUrls, publicUrl } from "./urls";

const log = logger("mcp");

export const INSTRUCTIONS = `freundebuch remembers what is going on in the lives of the people the user knows. The user rambles about a conversation; you file it with record_conversation. Before they meet someone, give them a briefing.
Pass the ramble verbatim as transcript, never a summary. What the user tells you about someone outside a conversation (a birthday, a fact, a gift idea) goes to remember.
Before recording, look for sensitive content: health, relationship trouble, money, anything said in confidence or "between us". If you find any, ask the user whether it should be private. Default to shared otherwise. When only part is sensitive, mark only those items private and keep that part out of the summary.
Resolve every person with find_person first. When more than one candidate fits, or a new name resembles an existing person, ask the user which one; never guess and never create a duplicate.
After recording, read back in one or two sentences what you filed, with the day it happened and the link to the conversation.
Every person, conversation and item comes with a url to it in the web app; give the user the link whenever they may want to look at something there.
When a briefing has suggestedInterval, offer it to the user and save it with set_interval once they agree.
Prefer an existing group, by name or other name, over a new one; when none fits, ask before creating one.
Who someone is to the household ("our landlady", "my colleague") is a relationship to "us" or "me", never a fact; say in German words what each end is (label, inverse), in each one's gender. What is going on and will end is a situation with a checkAfter; tell the user the day you chose. News about a situation needs a new checkAfter: suggest one and agree it with the user before filing. When a briefing or whats_due has a situation to ask about, suggest asking ("ask Jonas whether he found a car").`;

// A tool result: the body as structured content and, for clients that only read text, as JSON text. The body goes through the
// tool's output schema first, which drops every field the schema doesn't name: what leaves is only what was declared. Its links
// are made absolute against `base`, the server's public URL.
function result<S extends z.ZodType>(base: string, schema: S, body: z.input<S>) {
  const out = absoluteUrls(base, schema.parse(body)) as Record<string, unknown>;
  return {
    structuredContent: out,
    content: [{ type: "text" as const, text: JSON.stringify(out) }],
  };
}

// FreundebuchErrors are refusals the model can read. The SDK turns any other throw into a tool error carrying its message (a
// database error would leak a table or a value), so those are logged here and the client only gets "internal error".
function guard<A, R>(f: (args: A) => Promise<R>) {
  return async (args: A) => {
    try {
      return await f(args);
    } catch (e) {
      if (e instanceof FreundebuchError)
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: e.message }],
        };
      log.error({ err: e }, "tool failed");
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: "internal error" }],
      };
    }
  };
}

function server(v: Viewer, base: string): McpServer {
  const s = new McpServer({ name: "freundebuch", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  for (const t of TOOLS)
    s.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.input,
        outputSchema: t.output,
        annotations: t.annotations,
      },
      guard(async (args: unknown) => result(base, t.output, await t.run(v, args))) as never,
    );
  return s;
}

// The SDK's default is 4 MiB; a 30-minute ramble is about 40,000 characters, and the transcript holds at most 200,000.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

// "auto" answers with one JSON body unless a tool emits mid-call notifications, which ours never do. The gate has found the
// viewer already; it arrives here in authInfo.
const handler = createMcpHandler(({ authInfo }) => server(authInfo!.extra!.viewer as Viewer, authInfo!.extra!.base as string), {
  legacy: "reject",
  maxRequestBodySize: MAX_REQUEST_BYTES,
});

const rpcError = (status: number, message: string, headers?: Record<string, string>) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32600, message } }, { status, headers });

// What may reach the handler. The SDK doesn't check Origin, so a browser page of another site can't drive this endpoint: no
// Origin (server-side clients) passes, a present one must be our own host. That stops DNS rebinding only when PUBLIC_URL is set;
// without it our host comes from the request's own Host header. Then the caller needs an access token minted for /mcp.
async function gate(req: Request): Promise<Response | AuthInfo> {
  const origin = req.headers.get("origin");
  if (origin !== null) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== new URL(publicUrl(req.headers)).host) return rpcError(403, "forbidden origin");
  }
  const viewer = await viewerFromRequest(req, "mcp");
  if (viewer)
    return {
      token: "",
      clientId: "oauth",
      scopes: [],
      extra: { viewer, base: publicUrl(req.headers) },
    };
  const unauthorized = (message: string, error = "") =>
    rpcError(401, message, {
      "www-authenticate": `Bearer ${error}resource_metadata="${publicUrl(req.headers)}/.well-known/oauth-protected-resource/mcp"`,
    });
  // An access token we signed (now = 0 ignores expiry) that has expired, names another resource or a user that is gone:
  // invalid_token tells the client to refresh.
  if (verify("access", bearerOf(req.headers.get("authorization")), 0)) return unauthorized("invalid token", 'error="invalid_token", ');
  return unauthorized("sign-in required");
}

export async function mcpRoute(req: Request): Promise<Response> {
  const auth = await gate(req);
  if (auth instanceof Response) return auth;
  return handler.fetch(req, { authInfo: auth });
}
