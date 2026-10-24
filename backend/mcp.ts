// The MCP endpoint: POST /mcp, protocol 2026-07-28 only, eight tools over the same domain functions the REST API uses. Every call
// carries the user's own access token, and every tool acts as that viewer: privacy is decided in the domain, never by Claude.
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod";
import { bearerOf, viewerFromRequest } from "./auth/session";
import { verify } from "./auth/tokens";
import { briefing } from "./briefing";
import { getConversation, recordConversation } from "./conversations";
import { deleteItem, editItem, ITEM_TABLES, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript } from "./corrections";
import { whatsDue } from "./due";
import { FreundebuchError, InvalidInputError } from "./errors";
import { BriefingJson, Day, DueItemJson, IntervalJson, NewConversationJson, PersonId, PersonJson, RecordedJson, Visibility } from "./http/schemas";
import { setCheckInInterval } from "./intervals";
import { logger } from "./log";
import { addAlias, findPeople } from "./people";
import { addRelationship, addToGroup } from "./relationships";
import { RELATIONSHIP_TYPES, type Viewer } from "./types";
import { absoluteUrls, conversationPath, personPath, publicUrl } from "./urls";

const log = logger("mcp");

export const INSTRUCTIONS = `freundebuch remembers what is going on in the lives of the people the user knows. The user rambles about a conversation; you file it with record_conversation. Before they meet someone, give them a briefing.
Pass the ramble verbatim as transcript, never a summary.
Before recording, look for sensitive content: health, relationship trouble, money, anything said in confidence or "between us". If you find any, ask the user whether it should be private. Default to shared otherwise. When only part is sensitive, mark only those items private and keep that part out of the summary.
Resolve every person with find_person first. When more than one candidate fits, or a new name resembles an existing person, ask the user which one; never guess and never create a duplicate.
After recording, read back in one or two sentences what you filed, with the link to the conversation.
Every person, conversation and item comes with a url to it in the web app; give the user the link whenever they may want to look at something there.
When a briefing has suggestedInterval, offer it to the user and save it with set_interval once they agree.`;

// A tool result: the body as structured content and, for clients that only read text, as JSON text. The body goes through the
// tool's output schema first, which drops every field the schema doesn't name: what leaves is only what was declared. Its links
// are made absolute against `base`, the server's public URL.
function result<S extends z.ZodType>(base: string, schema: S, body: z.input<S>) {
  const out = absoluteUrls(base, schema.parse(body)) as Record<string, unknown>;
  return { structuredContent: out, content: [{ type: "text" as const, text: JSON.stringify(out) }] };
}

// FreundebuchErrors are refusals the model can read. The SDK turns any other throw into a tool error carrying its message (a
// database error would leak a table or a value), so those are logged here and the client only gets "internal error".
function guard<A, R>(f: (args: A) => Promise<R>) {
  return async (args: A) => {
    try {
      return await f(args);
    } catch (e) {
      if (e instanceof FreundebuchError) return { isError: true as const, content: [{ type: "text" as const, text: e.message }] };
      log.error({ err: e }, "tool failed");
      return { isError: true as const, content: [{ type: "text" as const, text: "internal error" }] };
    }
  };
}

// A named API schema (.meta({ id })) converts to a bare $ref, and a tool's schema must be an object at its root; a copy
// made by extend() carries no id, so it converts inline.
const NewConversation = NewConversationJson.extend({});
const Recorded = RecordedJson.extend({});
const BriefingOut = BriefingJson.extend({});

const ConversationId = z.string().describe("A conversation's id, as a briefing's recent conversations or record_conversation return it");
const Table = z.enum(ITEM_TABLES).describe("The kind of item");
const ItemId = z.string().describe("The item's id, as a briefing shows it");

const FoundJson = z.object({ people: z.array(PersonJson).describe("Best matches first, at most 5") });
const DueJson = z.object({ items: z.array(DueItemJson).describe("Most pressing first") });
const RelatedJson = z.object({
  id: z.string().optional().describe("The new relationship's id"),
  added: z.number().int().optional().describe("How many group memberships were new; one the user already recorded is kept as it was"),
  url: z.string().optional().describe("For a relationship: the page of `from`, which shows it, as an absolute URL"),
});
const SetIntervalJson = IntervalJson.extend({ personId: PersonId, url: z.string().describe("The person's page, as an absolute URL") });
const CorrectedJson = z.object({ corrected: z.literal(true) });
const TranscriptJson = z.object({
  conversationId: z.string(),
  url: z.string().describe("The conversation's page, as an absolute URL"),
  date: Day,
  transcript: z.string().nullable().describe("Null when the other user recorded it and it is private to them"),
});

// relate and correct take one of several argument shapes. A tool's input schema must be one flat object (the Anthropic API
// refuses a oneOf/anyOf/allOf at its root, and hosts then drop the tool), so the schema the client sees has every field optional
// beside the kind or action, and the handler checks the exact shape with a discriminated union.
function args<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidInputError(r.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; "));
  return r.data;
}

const RELATE_KINDS = ["relationship", "group"] as const;
const RelateInput = z.object({
  kind: z.enum(RELATE_KINDS).describe("`relationship` takes from, to, type and an optional note; `group` takes name and members"),
  from: PersonId.optional().describe("relationship: the person who is `type` of `to`"),
  to: PersonId.optional().describe("relationship: the other person"),
  type: z.enum(RELATIONSHIP_TYPES).optional().describe("relationship: `from` is `type` of `to`; with `parent`, from is the parent of to"),
  note: z.string().optional().describe("relationship: an optional note"),
  name: z.string().optional().describe("group: the group's name, e.g. Uni or Climbing"),
  members: z.array(PersonId).optional().describe("group: the ids of the people to add, at least one"),
  visibility: Visibility,
});

const RelateArgs = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relationship"),
    from: PersonId,
    to: PersonId,
    type: z.enum(RELATIONSHIP_TYPES).describe("`from` is `type` of `to`: with `parent`, from is the parent of to"),
    note: z.string().optional(),
    visibility: Visibility,
  }),
  z.object({ kind: z.literal("group"), name: z.string().describe("The group's name, e.g. Uni or Climbing"), members: z.array(PersonId).min(1), visibility: Visibility }),
]);

const CORRECT_ACTIONS = ["done", "outdated", "edit", "visibility", "delete", "rename", "alias", "merge", "share_transcript"] as const;
const CorrectInput = z.object({
  action: z
    .enum(CORRECT_ACTIONS)
    .describe(
      "done: mark a promise done or an exchange settled (table, id). outdated: mark a fact no longer true (id). edit: change fields of an item the user recorded (table, id, patch). visibility: change who can see an item the user recorded (table, id, visibility). delete: delete an item the user recorded, a conversation with its items (table, id). rename: rename a person (id, name). alias: add another name a person goes by (id, alias). merge: merge the duplicate drop into the person id (id, drop). share_transcript: let the partner read the transcript of a conversation the user recorded, once nothing in it is private any more (id); a transcript never turns shared on its own",
    ),
  table: Table.optional().describe("done, edit, visibility, delete: the kind of item (done: promises or exchanges)"),
  id: z.string().describe("The item's id as a briefing shows it; for rename, alias and merge, a person's id (merge: the person to keep); for share_transcript, a conversation's id"),
  patch: z.record(z.string(), z.unknown()).optional().describe("edit: new values for the item's own fields"),
  visibility: Visibility.optional().describe("visibility: who may see the item from now on"),
  name: z.string().optional().describe("rename: the person's new name"),
  alias: z.string().optional().describe("alias: another name the person goes by, e.g. a nickname"),
  drop: PersonId.optional().describe("merge: the duplicate person; it is deleted"),
});

const CorrectArgs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done"), table: z.enum(["promises", "exchanges"]), id: ItemId }).describe("Mark a promise done or an exchange settled"),
  z.object({ action: z.literal("outdated"), id: ItemId.describe("The fact's id") }).describe("Mark a fact no longer true"),
  z
    .object({ action: z.literal("edit"), table: Table, id: ItemId, patch: z.record(z.string(), z.unknown()).describe("New values for the item's own fields") })
    .describe("Change fields of an item the user recorded"),
  z.object({ action: z.literal("visibility"), table: Table, id: ItemId, visibility: Visibility }).describe("Change who can see an item the user recorded"),
  z.object({ action: z.literal("delete"), table: Table, id: ItemId }).describe("Delete an item the user recorded; a conversation takes its items with it"),
  z.object({ action: z.literal("rename"), id: PersonId, name: z.string() }).describe("Rename a person"),
  z.object({ action: z.literal("alias"), id: PersonId, alias: z.string() }).describe("Add another name a person goes by"),
  z.object({ action: z.literal("merge"), id: PersonId.describe("The person to keep"), drop: PersonId.describe("The duplicate; it is deleted") }).describe("Merge a duplicate person"),
  z.object({ action: z.literal("share_transcript"), id: ConversationId }).describe("Let the partner read a conversation's transcript"),
]);

function server(v: Viewer, base: string): McpServer {
  const ok = <S extends z.ZodType>(schema: S, body: z.input<S>) => result(base, schema, body);
  const s = new McpServer({ name: "freundebuch", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  s.registerTool(
    "record_conversation",
    {
      description:
        "File a conversation the user told you about, with the verbatim ramble as transcript, a short summary, who was involved and what was learned; use it after every ramble about meeting, calling or messaging someone. First resolve every person with find_person, ask the user when a name fits more than one person or resembles an existing one, and set confirmedNew on a new person only once the user said they are someone else. If anything is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling, and keep it out of the summary.",
      inputSchema: NewConversation,
      outputSchema: Recorded,
      annotations: { destructiveHint: false },
    },
    guard(async (c) => ok(Recorded, await recordConversation(v, c))),
  );

  s.registerTool(
    "find_person",
    {
      description:
        "Find people by name or alias, tolerant of spelling, each with context that tells people of the same name apart; always call this before referring to a person by id. When more than one candidate fits, ask the user which one.",
      inputSchema: z.object({ name: z.string().describe("A name or alias, as the user said it") }),
      outputSchema: FoundJson,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ name }) => ok(FoundJson, { people: await findPeople(v, name) })),
  );

  s.registerTool(
    "briefing",
    {
      description:
        "Everything worth knowing about a person: when the user last saw them, recent conversations, current facts, open promises and exchanges, gift ideas, upcoming dates and relationships. Use it before the user meets someone, or when they ask about a person.",
      inputSchema: z.object({ personId: PersonId }),
      outputSchema: BriefingOut,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ personId }) => ok(BriefingOut, await briefing(v, personId))),
  );

  s.registerTool(
    "whats_due",
    {
      description:
        "What needs attention soon: upcoming birthdays and other dates, promises with a due date, and people the user is overdue to see. Use it for questions like \"who should I call this weekend?\".",
      inputSchema: z.object({
        from: Day.optional().describe("The day to look from; today when left out"),
        horizonDays: z.number().int().min(1).max(366).optional().describe("How many days ahead to look; 14 when left out"),
      }),
      outputSchema: DueJson,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ from, horizonDays }) => ok(DueJson, { items: await whatsDue(v, from, horizonDays) })),
  );

  s.registerTool(
    "relate",
    {
      description:
        "Record how two people are related, or put people in a group, when the user mentions it outside of a conversation to file; pass person ids from find_person. If it is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling.",
      inputSchema: RelateInput,
      outputSchema: RelatedJson,
      annotations: { destructiveHint: false },
    },
    guard(async (input) => {
      const a = args(RelateArgs, input);
      return ok(
        RelatedJson,
        a.kind === "relationship"
          ? { ...(await addRelationship(v, { from: a.from, to: a.to, type: a.type, note: a.note, visibility: a.visibility })), url: personPath(a.from) }
          : await addToGroup(v, { name: a.name, members: a.members, visibility: a.visibility }),
      );
    }),
  );

  s.registerTool(
    "set_interval",
    {
      description:
        "Save how often the user wants to see a person, in days; null means no check-ins. Use it once the user agrees to a suggested interval or names one themselves.",
      inputSchema: z.object({
        personId: PersonId,
        days: z.number().int().nullable().describe("Days between check-ins, 1 to 3650; null for none"),
        confirmed: z.boolean().default(true).describe("Whether the user agreed to it; false only for an interval you set without asking"),
      }),
      outputSchema: SetIntervalJson,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    guard(async ({ personId, days, confirmed }) => {
      await setCheckInInterval(v, personId, days, confirmed);
      return ok(SetIntervalJson, { personId, days, confirmed, url: personPath(personId) });
    }),
  );

  s.registerTool(
    "correct",
    {
      description:
        "Fix something already filed: mark a promise done or an exchange settled, mark a fact outdated, edit or delete an item, change who can see it, rename a person or add an alias, merge a duplicate or let the partner read a transcript. Use it when the user says something is done, no longer true or wrong.",
      inputSchema: CorrectInput,
      outputSchema: CorrectedJson,
      annotations: { destructiveHint: true },
    },
    guard(async (input) => {
      const a = args(CorrectArgs, input);
      switch (a.action) {
        case "done":
          await markDone(v, a.table, a.id);
          break;
        case "outdated":
          await markOutdated(v, a.id);
          break;
        case "edit":
          await editItem(v, a.table, a.id, a.patch);
          break;
        case "visibility":
          await setVisibility(v, a.table, a.id, a.visibility);
          break;
        case "delete":
          await deleteItem(v, a.table, a.id);
          break;
        case "rename":
          await renamePerson(v, a.id, a.name);
          break;
        case "alias":
          await addAlias(v, a.id, a.alias);
          break;
        case "merge":
          await mergePeople(v, a.id, a.drop);
          break;
        case "share_transcript":
          await shareTranscript(v, a.id);
          break;
      }
      return ok(CorrectedJson, { corrected: true as const });
    }),
  );

  s.registerTool(
    "get_transcript",
    {
      description: "The verbatim ramble a conversation was recorded from. Use it when the user asks what exactly was said, or a briefing's summary isn't enough.",
      inputSchema: z.object({ conversationId: ConversationId }),
      outputSchema: TranscriptJson,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ conversationId }) => {
      const c = await getConversation(v, conversationId);
      return ok(TranscriptJson, { conversationId: c.id, url: conversationPath(c.id), date: c.date, transcript: c.transcript });
    }),
  );
  return s;
}

// The SDK's default is 4 MiB; a 30-minute ramble is about 40,000 characters, and the transcript holds at most 200,000.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

// "auto" answers with one JSON body unless a tool emits mid-call notifications, which ours never do. The gate has found the
// viewer already; it arrives here in authInfo.
const handler = createMcpHandler(({ authInfo }) => server(authInfo!.extra!.viewer as Viewer, authInfo!.extra!.base as string), { legacy: "reject", maxRequestBodySize: MAX_REQUEST_BYTES });

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
  if (viewer) return { token: "", clientId: "oauth", scopes: [], extra: { viewer, base: publicUrl(req.headers) } };
  const unauthorized = (message: string, error = "") =>
    rpcError(401, message, { "www-authenticate": `Bearer ${error}resource_metadata="${publicUrl(req.headers)}/.well-known/oauth-protected-resource/mcp"` });
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
