// The REST API, /api/v1, defined in code: this table is the single source. `dispatch` serves requests
// through it, and openApiDocument() generates the OpenAPI 3.1 description. Each handler is typed from
// its own declared responses (see op() in dispatch.ts). Adding a route is adding an entry to OPS.
import * as z from "zod";
import { briefing } from "../briefing";
import { createCalendarKey, feedPath, hasCalendarKey, revokeCalendarKey } from "../calendar";
import { IDENTITY_COOKIE } from "../auth/session";
import { deleteItem, editItem, factToRelationship, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript, type ItemTable } from "../corrections";
import { getConversation, recordConversation } from "../conversations";
import { whatsDue } from "../due";
import { InvalidInputError, InvalidRequestError, NotFoundError } from "../errors";
import { addGroupAlias, addToGroupById, createGroup, deleteGroup, getGroup, listGroups, mergeGroups, removeFromGroup, removeGroupAlias, renameGroup } from "../groups";
import { setCheckInInterval } from "../intervals";
import { orbit } from "../orbit";
import { addAlias, findPeople, getPerson, listPeople, setGender } from "../people";
import { getSettings, putSettings, testWebhook } from "../settings";
import { createShareKey, discardScreenshot, listPending, resolveScreenshot, retryScreenshot, revokeShareKey, screenshotModel } from "../screenshots";
import { API_PREFIX, publicUrl } from "../urls";
import { createDispatcher, op, type AnyOp, type ResponseSpec } from "./dispatch";
import {
  AliasJson,
  BriefingJson,
  CalendarFeedJson,
  COMPONENTS,
  ConversationJson,
  DueListJson,
  ErrorJson,
  GroupDetailJson,
  GroupListJson,
  GroupJson,
  GroupMergeJson,
  GroupNameJson,
  IdParam,
  IntervalJson,
  ItemPatchJson,
  MergeJson,
  NewConversationJson,
  OrbitJson,
  PendingScreenshotListJson,
  PeopleQuery,
  PersonJson,
  PersonPatchJson,
  FactRelationshipJson,
  RelationshipIdsJson,
  PersonListJson,
  RecordedJson,
  ResolutionJson,
  ResolvedJson,
  SentJson,
  SettingsJson,
  ShareKeyJson,
  TableParam,
} from "./schemas";

export { API_PREFIX };

const err = (description: string) => ({ description, schema: ErrorJson }) satisfies ResponseSpec;
const E = {
  400: err("The request can't be read (`invalid_request`), or a value in it is not acceptable (`invalid_input`)"),
  401: err("No valid sign-in or access token (`unauthorized`)"),
  403: err("The item is visible to the caller but only its recorder may change it (`forbidden`)"),
  404: err("No such thing, or one the caller may not see (`not_found`)"),
  409: err("The request names more than one match (`ambiguous`)"),
} as const;
const { 400: E400, 401: E401, 403: E403, 404: E404 } = E;
const NO_CONTENT = { description: "Done" } satisfies ResponseSpec;

const OPS: AnyOp[] = [
  op({
    method: "GET",
    path: `${API_PREFIX}/people`,
    operationId: "listPeople",
    summary: "List or search people",
    description: "With `q`, the best matches for a name or alias, each with `context` hints from what the caller may see; without, everyone by name.",
    tags: ["People"],
    auth: true,
    params: {},
    query: PeopleQuery,
    responses: { 200: { description: "People", schema: PersonListJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, query }) => ({ status: 200, body: query.q ? await findPeople(viewer, query.q) : await listPeople(viewer) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/people/{id}`,
    operationId: "getPerson",
    summary: "Get a person",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The person", schema: PersonJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await getPerson(viewer, params.id) })),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/people/{id}`,
    operationId: "updatePerson",
    summary: "Rename a person, or set their gender",
    description: "Names and gender are shared: the other user sees them too. Set a gender only when the user states it or uses a pronoun for the person, never from the name.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    body: PersonPatchJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    if (body.name !== undefined) await renamePerson(viewer, params.id, body.name);
    if (body.gender !== undefined) await setGender(viewer, params.id, body.gender);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/people/{id}/briefing`,
    operationId: "getBriefing",
    summary: "Everything to know before meeting a person",
    description: "As the caller sees it: private items of other users are never part of it.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The briefing", schema: BriefingJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await briefing(viewer, params.id) })),

  op({
    method: "PUT",
    path: `${API_PREFIX}/people/{id}/interval`,
    operationId: "setCheckInInterval",
    summary: "Set how often to check in with a person",
    description: "The caller's own interval; other users keep theirs.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    body: IntervalJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await setCheckInInterval(viewer, params.id, body.days, body.confirmed);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/people/{id}/merge`,
    operationId: "mergePeople",
    summary: "Merge a duplicate into a person",
    description: "Everything of `drop` moves to the person in the path, and `drop` is deleted. A user's own person can't be merged away.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    body: MergeJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await mergePeople(viewer, params.id, body.drop);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/people/{id}/aliases`,
    operationId: "addAlias",
    summary: "Add another name a person goes by",
    description: "Aliases are shared, like names, and searching finds the person by them. One the person already has, or their name, changes nothing.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    body: AliasJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await addAlias(viewer, params.id, body.alias);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/groups`,
    operationId: "listGroups",
    summary: "List groups",
    description: "Every group the caller sees: the ones every household starts with, their own, and any with a member they may see.",
    tags: ["Groups"],
    auth: true,
    params: {},
    responses: { 200: { description: "Groups by name", schema: GroupListJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await listGroups(viewer) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/groups`,
    operationId: "createGroup",
    summary: "Create a group",
    description: "A name that already names a group, or is one of its other names, returns that group instead of a duplicate.",
    tags: ["Groups"],
    auth: true,
    params: {},
    body: GroupNameJson,
    responses: { 201: { description: "The group", schema: GroupJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, body }) => ({ status: 201, body: await createGroup(viewer, body.name) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/groups/{id}`,
    operationId: "getGroup",
    summary: "A group with its members",
    description: "Members never seen first, then the most overdue.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The group", schema: GroupDetailJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await getGroup(viewer, params.id) })),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/groups/{id}`,
    operationId: "renameGroup",
    summary: "Rename a group",
    description: "The old name becomes another name of the group. A name that already means another group is `invalid_input`: merge them instead.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam },
    body: GroupNameJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await renameGroup(viewer, params.id, body.name);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/groups/{id}/aliases`,
    operationId: "addGroupAlias",
    summary: "Add another name for a group",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam },
    body: AliasJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await addGroupAlias(viewer, params.id, body.alias);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/groups/{id}/aliases/{alias}`,
    operationId: "removeGroupAlias",
    summary: "Remove another name of a group",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam, alias: z.string().describe("The other name, however it is spelled") },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await removeGroupAlias(viewer, params.id, params.alias);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/groups/{id}/merge`,
    operationId: "mergeGroups",
    summary: "Merge a group into this one",
    description: "Every membership moves here and `drop`'s names become other names of this group; `drop` is deleted.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam },
    body: GroupMergeJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await mergeGroups(viewer, params.id, body.drop);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/groups/{id}`,
    operationId: "deleteGroup",
    summary: "Delete a group for the caller",
    description: "Removes the caller's own memberships; the group stays while the other user still has some.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await deleteGroup(viewer, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/groups/{id}/members/{personId}`,
    operationId: "addGroupMember",
    summary: "Put a person in a group",
    description: "A shared membership recorded by the caller.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam, personId: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await addToGroupById(viewer, params.id, params.personId, "shared");
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/groups/{id}/members/{personId}`,
    operationId: "removeGroupMember",
    summary: "Take a person out of a group",
    description: "Removes the caller's membership and the other user's shared one; the other user's private one stays.",
    tags: ["Groups"],
    auth: true,
    params: { id: IdParam, personId: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await removeFromGroup(viewer, params.id, params.personId);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/due`,
    operationId: "getDue",
    summary: "What needs attention",
    description: "Dates coming up, people past their check-in interval, and promises with a due date.",
    tags: ["People"],
    auth: true,
    params: {},
    responses: { 200: { description: "Due items, most pressing first", schema: DueListJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await whatsDue(viewer) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/orbit`,
    operationId: "getOrbit",
    summary: "The people worth a look, placed around the caller",
    description:
      "At most 24, most urgent first: overdue or nearly so, seen within 14 days, a birthday within 14 days, or an open promise. " +
      "Rings follow the caller's own last seen and interval; another user's private conversations never move a face.",
    tags: ["People"],
    auth: true,
    params: {},
    responses: { 200: { description: "Faces, most urgent first", schema: OrbitJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await orbit(viewer) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/conversations`,
    operationId: "recordConversation",
    summary: "Record a conversation",
    description:
      "Everything lands in one transaction: a bad item leaves nothing behind. A private conversation makes every item private. " +
      "A new person named like an existing person or alias is `ambiguous` (409, listing the candidates) unless `confirmedNew`.",
    tags: ["Conversations"],
    auth: true,
    params: {},
    body: NewConversationJson,
    responses: { 201: { description: "Recorded", schema: RecordedJson }, 400: E400, 401: E401, 404: E404, 409: E[409] },
  }).handle(async ({ viewer, body }) => ({ status: 201, body: await recordConversation(viewer, body) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/conversations/{id}`,
    operationId: "getConversation",
    summary: "Get a conversation",
    description: "With the items the caller may see. `transcript` is null when it is private to someone else.",
    tags: ["Conversations"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The conversation", schema: ConversationJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await getConversation(viewer, params.id) })),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/items/{table}/{id}`,
    operationId: "editItem",
    summary: "Correct an item",
    description:
      "The body holds exactly one of `done`, `outdated`, `visibility`, `patch` or `transcriptShared`; none or several is `invalid_request`. " +
      "A transcript turns private whenever anything recorded with it does, and turns shared again only through `transcriptShared`.",
    tags: ["Items"],
    auth: true,
    params: { table: TableParam, id: IdParam },
    body: ItemPatchJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: E403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    const table = params.table as ItemTable;
    const given = [body.done, body.outdated, body.visibility, body.patch, body.transcriptShared].filter((x) => x !== undefined).length;
    if (given !== 1) throw new InvalidRequestError("Give exactly one of done, outdated, visibility, patch or transcriptShared");
    if (body.done) {
      if (table !== "promises" && table !== "exchanges") throw new InvalidInputError("Only a promise or an exchange can be marked done");
      await markDone(viewer, table, params.id);
    } else if (body.outdated) {
      if (table !== "facts") throw new InvalidInputError("Only a fact can be marked outdated");
      await markOutdated(viewer, params.id);
    } else if (body.transcriptShared) {
      if (table !== "conversations") throw new InvalidInputError("Only a conversation has a transcript");
      await shareTranscript(viewer, params.id);
    } else if (body.visibility) await setVisibility(viewer, table, params.id, body.visibility);
    else await editItem(viewer, table, params.id, body.patch!);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/items/facts/{id}/relationship`,
    operationId: "factToRelationship",
    summary: "Turn a fact into a relationship",
    description:
      'For a fact that says who someone is ("unsere Vermieterin"): it becomes a relationship with the fact\'s visibility, and the fact is deleted. `from` and `to` take a person id, "me" or "us". Only the fact\'s recorder may.',
    tags: ["Items"],
    auth: true,
    params: { id: IdParam },
    body: FactRelationshipJson,
    responses: { 201: { description: "The relationships", schema: RelationshipIdsJson }, 400: E400, 401: E401, 403: E403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => ({ status: 201, body: await factToRelationship(viewer, params.id, body) })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/items/{table}/{id}`,
    operationId: "deleteItem",
    summary: "Delete an item",
    description: "Only its recorder may.",
    tags: ["Items"],
    auth: true,
    params: { table: TableParam, id: IdParam },
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: E403, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await deleteItem(viewer, params.table as ItemTable, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/me/settings`,
    operationId: "getSettings",
    summary: "The caller's settings",
    tags: ["Settings"],
    auth: true,
    params: {},
    responses: { 200: { description: "The settings", schema: SettingsJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await getSettings(viewer) })),

  op({
    method: "PUT",
    path: `${API_PREFIX}/me/settings`,
    operationId: "putSettings",
    summary: "Change the caller's settings",
    tags: ["Settings"],
    auth: true,
    params: {},
    body: SettingsJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401 },
  }).handle(async ({ viewer, body }) => {
    await putSettings(viewer, body);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/me/settings/test`,
    operationId: "testWebhook",
    summary: "Send a test message to the caller's webhook",
    description: "`sent` is false when there is no webhook or it didn't accept the message.",
    tags: ["Settings"],
    auth: true,
    params: {},
    responses: { 200: { description: "Whether it was sent", schema: SentJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { sent: await testWebhook(viewer) } })),

  op({
    method: "GET",
    path: `${API_PREFIX}/screenshots`,
    operationId: "listPendingScreenshots",
    summary: "The caller's shared screenshots that wait for them",
    description: "Being read, waiting for a decision, or failed; newest first. Only the caller's own: the other user's never show.",
    tags: ["Screenshots"],
    auth: true,
    params: {},
    responses: { 200: { description: "Waiting screenshots", schema: PendingScreenshotListJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await listPending(viewer) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/screenshots/{id}/resolve`,
    operationId: "resolveScreenshot",
    summary: "File a waiting screenshot on a person",
    description: "Give `personId` or the `name` of a new person. The handle Claude read becomes one of the person's other names.",
    tags: ["Screenshots"],
    auth: true,
    params: { id: IdParam },
    body: ResolutionJson,
    responses: { 200: { description: "Filed", schema: ResolvedJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => ({ status: 200, body: await resolveScreenshot(viewer, params.id, body) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/screenshots/{id}/retry`,
    operationId: "retryScreenshot",
    summary: "Read a failed screenshot again",
    tags: ["Screenshots"],
    auth: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    const model = screenshotModel();
    if (!model) throw new NotFoundError("Sharing screenshots is off on this instance");
    await retryScreenshot(viewer, params.id, model);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/screenshots/{id}`,
    operationId: "discardScreenshot",
    summary: "Throw a waiting screenshot away",
    tags: ["Screenshots"],
    auth: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await discardScreenshot(viewer, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/me/share-key`,
    operationId: "createShareKey",
    summary: "A new share key for the iPhone Shortcut",
    description: "The key can only hand in screenshots (POST /api/share). A new one replaces the old one.",
    tags: ["Screenshots"],
    auth: true,
    params: {},
    responses: { 200: { description: "The new key", schema: ShareKeyJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { key: await createShareKey(viewer) } })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/me/share-key`,
    operationId: "revokeShareKey",
    summary: "Turn the caller's share key off",
    tags: ["Screenshots"],
    auth: true,
    params: {},
    responses: { 204: NO_CONTENT, 401: E401 },
  }).handle(async ({ viewer }) => {
    await revokeShareKey(viewer);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/me/calendar-feed`,
    operationId: "getCalendarFeed",
    summary: "Whether the caller has a calendar feed",
    description: "The URL itself is shown only when it is made: only its hash is kept.",
    tags: ["Calendar"],
    auth: true,
    params: {},
    responses: { 200: { description: "The feed's state; `url` is always null here", schema: CalendarFeedJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { active: await hasCalendarKey(viewer), created: false, url: null } })),

  op({
    method: "POST",
    path: `${API_PREFIX}/me/calendar-feed`,
    operationId: "createCalendarFeed",
    summary: "A new secret URL for the caller's calendar feed",
    description:
      "An ICS feed of the birthdays, other dates and the caller's own promises with a due date that the caller may see, for Google Calendar or any calendar app. Anyone with the URL can read it. A new one replaces the old one, which stops working.",
    tags: ["Calendar"],
    auth: true,
    params: {},
    responses: { 200: { description: "The new feed URL", schema: CalendarFeedJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { active: true, created: true, url: feedPath(await createCalendarKey(viewer)) } })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/me/calendar-feed`,
    operationId: "revokeCalendarFeed",
    summary: "Turn the caller's calendar feed off",
    tags: ["Calendar"],
    auth: true,
    params: {},
    responses: { 204: NO_CONTENT, 401: E401 },
  }).handle(async ({ viewer }) => {
    await revokeCalendarKey(viewer);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/openapi.json`,
    operationId: "getOpenApi",
    summary: "This API's OpenAPI document",
    description: "Generated from the server's route table, with `servers` set to this instance's URL.",
    tags: ["Meta"],
    auth: true,
    params: {},
    responses: { 200: { description: "OpenAPI 3.1", schema: z.record(z.string(), z.unknown()) }, 401: E401 },
  }).handle(async ({ req }) => ({ status: 200, body: openApiDocument(publicUrl(req.headers)) })),
];

export const dispatch = createDispatcher(OPS, API_PREFIX);

// --- The OpenAPI document. ---

type Json = Record<string, unknown>;
const URI = (id: string) => `#/components/schemas/${id}`;

// A schema as OpenAPI wants it: a $ref for a component, else inline JSON Schema.
function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): Json {
  const id = (z.globalRegistry.get(schema) as { id?: string } | undefined)?.id;
  if (id) return { $ref: URI(id) };
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  delete json.$schema;
  return json;
}

export function openApiDocument(serverUrl: string): Json {
  const registry = z.registry<{ id: string }>();
  for (const c of COMPONENTS) registry.add(c, { id: (z.globalRegistry.get(c) as { id: string }).id });
  const { schemas } = z.toJSONSchema(registry, { uri: URI, io: "input" }) as { schemas: Record<string, Json> };
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Json> = {};
  for (const entry of OPS) {
    const parameters = [
      ...Object.entries(entry.params).map(([name, s]) => {
        const { description, ...schema } = jsonSchema(s);
        return { name, in: "path", required: true, description, schema };
      }),
      ...Object.entries(entry.query?.shape ?? {}).map(([name, s]) => {
        const field = s as z.ZodType;
        const { description, ...schema } = jsonSchema(field, "input");
        return { name, in: "query", required: !field.safeParse(undefined).success, description, schema };
      }),
    ];
    const responses = Object.fromEntries(
      Object.entries(entry.responses as Record<number, ResponseSpec>).map(([status, r]) => [
        status,
        { description: r.description, ...(r.schema && { content: { "application/json": { schema: jsonSchema(r.schema) } } }) },
      ]),
    );
    paths[entry.path] = {
      ...paths[entry.path],
      [entry.method.toLowerCase()]: {
        operationId: entry.operationId,
        summary: entry.summary,
        ...(entry.description && { description: entry.description }),
        tags: entry.tags,
        security: [{ bearer: [] }, { cookie: [] }],
        ...(parameters.length && { parameters }),
        ...(entry.body && { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(entry.body, "input") } } } }),
        responses,
      },
    };
  }

  return {
    openapi: "3.1.1",
    info: {
      title: "Freundebuch API",
      version: "1",
      description:
        "A personal CRM for two: people, the conversations with them, and what to remember before the next one.\n\n" +
        "Every error is JSON, `{\"error\": \"...\", \"code\": \"...\"}`. Besides the responses listed per operation, " +
        "an unknown path under /api/v1 answers 404 (`not_found`), a method an operation doesn't have answers 405 with `Allow`, " +
        "and a failure on the server's side answers 500 (`internal`) without details.",
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "People", description: "Who is in the book, and what to know before meeting them." },
      { name: "Conversations", description: "Recording what was said, and reading it back." },
      { name: "Groups", description: "Groups of people, with other names that find them." },
      { name: "Items", description: "Corrections after the fact: facts, promises, dates, exchanges, relationships and conversations." },
      { name: "Calendar", description: "The secret URL of the caller's calendar feed (ICS), served at /api/calendar/{key}.ics." },
      { name: "Meta", description: "About the API itself." },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An OAuth access token issued for this API's URL (`/api/v1`)" },
        cookie: { type: "apiKey", in: "cookie", name: IDENTITY_COOKIE, description: "The browser's sign-in; on anything but a GET only from the app's own pages" },
      },
    },
  };
}
