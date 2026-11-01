// The REST API, /api/v1, defined in code: this table is the single source. `dispatch` serves requests
// through it, and openApiDocument() generates the OpenAPI 3.1 description. Each handler is typed from
// its own declared responses (see op() in dispatch.ts). Adding a route is adding an entry to OPS.
import * as z from "zod";
import { briefing } from "../reading/briefing";
import { createCalendarKey, feedPath, hasCalendarKey, revokeCalendarKey } from "../sharing/calendar";
import { IDENTITY_COOKIE } from "../auth/session";
import {
  deleteItem,
  editItem,
  factToRelationship,
  markDone,
  markOutdated,
  mergePeople,
  renamePerson,
  setVisibility,
  shareTranscript,
  type ItemTable,
} from "../conversations/corrections";
import { getConversation, record } from "../conversations/conversations";
import { whatsDue } from "../reading/due";
import { InvalidInputError, InvalidRequestError, NotFoundError } from "../core/errors";
import {
  addGroupAlias,
  addToGroupById,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  mergeGroups,
  removeFromGroup,
  removeGroupAlias,
  renameGroup,
} from "../people/groups";
import { setCheckInInterval } from "../people/intervals";
import { orbit } from "../people/orbit";
import { traitsFor } from "../people/traits";
import { cardPath, deleteOwnCard, ownCards, publishCard, setOwnCard, subscribeCard, unpublishCard, unsubscribeCard } from "../sharing/cards";
import { birthdayMessage } from "../sharing/greetings";
import { journalEntries } from "../journal/journal";
import { search } from "../reading/search";
import { experienceKinds, getPlace, getSeries, listExperiences, listSeries } from "../experiences/experiences";
import { findPlaces, placesInside, placesOf } from "../experiences/places";
import { setLook } from "../people/looks";
import { addAlias, findPeople, getPerson, listPeople, setGender } from "../people/people";
import { getSettings, putSettings, setLanguage, testWebhook } from "../core/settings";
import { getReflection, putReflection } from "../journal/reflection";
import { deleteRamble } from "../conversations/rambles";
import { createShareKey, discardFile, listPending, retryFile, revokeShareKey, fileModel } from "../conversations/files";
import { acceptInvitationAs, invite, listInvitations, revokeInvitation } from "../people/invitations";
import { inBook, listBooks, newBook } from "../people/books";
import { deleteBook, handOver, leaveBook, removeMember, renameBook, setRole } from "../people/manage";
import type { Viewer } from "../core/types";
import { movePeople } from "../people/moves";
import { API_PREFIX, publicUrl } from "../core/urls";
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
  LabelParam,
  IntervalJson,
  ItemPatchJson,
  MergeJson,
  NewRambleJson,
  OrbitJson,
  PendingFileListJson,
  PeopleQuery,
  SearchJson,
  SearchQuery,
  PersonJson,
  PersonPatchJson,
  FactRelationshipJson,
  RelationshipIdsJson,
  PersonListJson,
  RecordedRambleJson,
  SentJson,
  SettingsJson,
  LanguageJson,
  ReflectionJson,
  ShareKeyJson,
  TableParam,
  TraitsJson,
  TraitsQuery,
  JournalJson,
  JournalQuery,
  ExperiencesJson,
  ExperienceQuery,
  PlaceListJson,
  SeriesJson,
  PlaceViewJson,
  CardJson,
  CardLinkJson,
  CardSubscribeJson,
  OwnCardJson,
  OwnCardsJson,
  PersonCardJson,
  BirthdayMessageJson,
  BirthdayMessageQuery,
} from "./schemas";

export { API_PREFIX };

const err = (description: string) => ({ description, schema: ErrorJson }) satisfies ResponseSpec;
const E = {
  400: err("The request can't be read (`invalid_request`), or a value in it is not acceptable (`invalid_input`)"),
  401: err("No valid sign-in or access token (`unauthorized`)"),
  403: err("The item is visible to the caller, but this change is its recorder's: its visibility, a conversation, a transcript (`forbidden`)"),
  404: err("No such thing, or one the caller may not see (`not_found`)"),
  409: err("The request names more than one match (`ambiguous`)"),
} as const;
const { 400: E400, 401: E401, 403: E403, 404: E404 } = E;
const NO_CONTENT = { description: "Done" } satisfies ResponseSpec;

const RoleJson = z.enum(["owner", "admin", "member"]);
const BookRefJson = z.object({ id: z.string(), name: z.string() });
const BookViewJson = BookRefJson.extend({
  role: RoleJson.describe("The caller's role in it"),
  members: z.array(z.object({ id: z.string().describe("The member's user id"), name: z.string(), role: RoleJson })),
});
const InvitationJson = z.object({ id: z.string(), role: z.enum(["member", "admin"]), createdBy: z.string(), expiresAt: z.number() });
const NewInvitationJson = z.object({ id: z.string(), url: z.string().describe("The link to pass on"), expiresAt: z.number() });
const MovedJson = z.object({
  book: BookRefJson.describe("The book they are in now"),
  people: z.array(
    z.object({
      from: z.string().describe("The old id"),
      id: z.string().describe("The new id"),
      name: z.string(),
      url: z.string(),
      remains: z.boolean().describe("Whether an entry for them stays in the old book, for what is filed there that didn't move"),
    }),
  ),
  moved: z.record(z.string(), z.number()),
  stayed: z.record(z.string(), z.number()),
});
const BOOK_ID = { id: z.string().describe("The book's id") };
const ROLE_403 = err("The caller's role in the book doesn't allow it (`forbidden`)");
// A book's routes run on the caller in that book; a book they aren't in is not found.
const theBook = (viewer: Viewer, id: string) => inBook(viewer, id);
/** A comma-separated list of ids from the query, without empty entries. */
const ids = (list?: string) =>
  list
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const ROUTES: AnyOp[] = [
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
    summary: "Rename a person, or set their gender or look",
    description:
      "Names, gender and look are shared: the other user sees them too. Set a gender only when the user states it or uses a pronoun for the person, never from the name.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    body: PersonPatchJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    if (body.name !== undefined) await renamePerson(viewer, params.id, body.name);
    if (body.gender !== undefined) await setGender(viewer, params.id, body.gender);
    if (body.look !== undefined) await setLook(viewer, params.id, body.look);
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
    method: "GET",
    path: `${API_PREFIX}/people/{id}/birthday-message`,
    operationId: "getBirthdayMessage",
    summary: "What birthday wishes to a person can be written from, and links to send them",
    description:
      "When the birthday is and what the caller knows about the person, without anything about health, for drafting a message the caller sends themselves. With `text`, links that open WhatsApp, Telegram, SMS or email with it filled in. freundebuch sends nothing.",
    tags: ["People"],
    auth: true,
    params: { id: IdParam },
    query: BirthdayMessageQuery,
    responses: { 200: { description: "The birthday message", schema: BirthdayMessageJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, query }) => ({ status: 200, body: await birthdayMessage(viewer, params.id, query.text) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/traits`,
    operationId: "getTraits",
    summary: "What several people need and how they are",
    description: "Any mix of people and groups, each person once. As the caller sees it: private items of other users are never part of it.",
    tags: ["People"],
    auth: true,
    params: {},
    query: TraitsQuery,
    responses: { 200: { description: "The traits", schema: TraitsJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, query }) => ({
    status: 200,
    body: { people: await traitsFor(viewer, { people: ids(query.people), groups: ids(query.groups) }) },
  })),

  op({
    method: "GET",
    path: `${API_PREFIX}/search`,
    operationId: "search",
    summary: "Find what was told by a word",
    description:
      "Transcripts, conversations, experiences, journal entries, items and places that hold every word of `q`, newest first. " +
      "Only what the caller may see can match: another user's private items never do, and a transcript only when the caller may read it.",
    tags: ["Conversations"],
    auth: true,
    params: {},
    query: SearchQuery,
    responses: { 200: { description: "The hits", schema: SearchJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, query }) => ({ status: 200, body: { hits: await search(viewer, query.q) } })),

  op({
    method: "GET",
    path: `${API_PREFIX}/journal`,
    operationId: "getJournal",
    summary: "The caller's journal entries in a period",
    description: "The caller's own entries and the ones the other user shared, newest first. A private entry of the other user never shows.",
    tags: ["Journal"],
    auth: true,
    params: {},
    query: JournalQuery,
    responses: { 200: { description: "The entries", schema: JournalJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, query }) => ({ status: 200, body: { entries: await journalEntries(viewer, query) } })),

  op({
    method: "GET",
    path: `${API_PREFIX}/experiences`,
    operationId: "listExperiences",
    summary: "What the caller lived through",
    description:
      "Experiences the caller may see, newest first, optionally of a kind, in a period, at a place, in a series or with a person; with the kinds and series in use.",
    tags: ["Experiences"],
    auth: true,
    params: {},
    query: ExperienceQuery,
    responses: { 200: { description: "The experiences", schema: ExperiencesJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, query }) => {
    const [experiences, kinds, series] = await Promise.all([listExperiences(viewer, query), experienceKinds(viewer), listSeries(viewer)]);
    return { status: 200, body: { experiences, kinds, series } };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/series/{id}`,
    operationId: "getSeries",
    summary: "A series and its sessions",
    tags: ["Experiences"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The series", schema: SeriesJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await getSeries(viewer, params.id) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/places/{id}`,
    operationId: "getPlace",
    summary: "A place and everything at it the caller may see",
    tags: ["Experiences"],
    auth: true,
    params: { id: IdParam },
    responses: { 200: { description: "The place", schema: PlaceViewJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await getPlace(viewer, params.id) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/places`,
    operationId: "findPlaces",
    summary: "Find places by name, by a person, or inside a place",
    description:
      "Exactly one of: `q`, places the caller may see whose name or other name matches, tolerant of spelling, best first; `person`, the places of the conversations and experiences the person was part of, newest first, with how often and when last; `inside`, the places directly inside a place.",
    tags: ["Experiences"],
    auth: true,
    params: {},
    query: z.object({
      q: z.string().optional().describe("A place's name, or part of it"),
      person: z.string().optional().describe("A person's id"),
      inside: z.string().optional().describe("A place's id"),
    }),
    responses: { 200: { description: "The places", schema: PlaceListJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, query }) => {
    const { q, person, inside } = query;
    if ([q, person, inside].filter((x) => x !== undefined).length !== 1) throw new InvalidInputError("Give exactly one of q, person or inside");
    return {
      status: 200,
      body: q !== undefined ? await findPlaces(viewer, q) : person !== undefined ? await placesOf(viewer, person) : await placesInside(viewer, inside!),
    };
  }),

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
    path: `${API_PREFIX}/rambles`,
    operationId: "record",
    summary: "Record a ramble and its parts",
    description:
      "One ramble, split into conversations, journal entries and items; each item may be `in` one of its conversations. " +
      "Everything lands in one transaction: a bad part leaves nothing behind. A private ramble makes every part private; journal entries are private unless `shared`. " +
      "A new person named like an existing person or alias is `ambiguous` (409, listing the candidates) unless `confirmedNew`.",
    tags: ["Rambles"],
    auth: true,
    params: {},
    body: NewRambleJson,
    responses: { 201: { description: "Recorded", schema: RecordedRambleJson }, 400: E400, 401: E401, 404: E404, 409: E[409] },
  }).handle(async ({ viewer, body }) => ({ status: 201, body: await record(viewer, body) })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/rambles/{id}`,
    operationId: "deleteRamble",
    summary: "Delete a ramble and everything told in it",
    description: "Its transcript, conversations, journal entries and items. Only its recorder may.",
    tags: ["Rambles"],
    auth: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 403: E403, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await deleteRamble(viewer, params.id);
    return { status: 204, body: undefined };
  }),

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
      'For a fact that says who someone is ("unsere Vermieterin"): it becomes a relationship with the fact\'s visibility, and the fact is deleted. `from` and `to` take a person id, "me" or "us". Either user may, for a shared fact.',
    tags: ["Items"],
    auth: true,
    params: { id: IdParam },
    body: FactRelationshipJson,
    responses: { 201: { description: "The relationships", schema: RelationshipIdsJson }, 400: E400, 401: E401, 403: E403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => ({ status: 201, body: { ids: (await factToRelationship(viewer, params.id, body)).ids } })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/items/{table}/{id}`,
    operationId: "deleteItem",
    summary: "Delete an item",
    description: "Its recorder, or either user for a shared item; a conversation, which takes its items with it, only its recorder.",
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
    method: "GET",
    path: `${API_PREFIX}/me/cards`,
    operationId: "getOwnCards",
    summary: "The caller's own cards",
    description:
      'What the caller says about themselves (number, address, birthday), on as many cards as they keep ("Privat", "Arbeit"), each for the people they give its link to.',
    tags: ["Cards"],
    auth: true,
    params: {},
    responses: { 200: { description: "The cards", schema: OwnCardsJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { cards: await ownCards(viewer) } })),

  op({
    method: "PUT",
    path: `${API_PREFIX}/me/cards/{label}`,
    operationId: "putOwnCard",
    summary: "Write one of the caller's own cards",
    description:
      "Writes the card of that name, a new one when there is none (names match without regard to case). Empty fields are dropped. A published link serves the new card from now on; whoever subscribed to it gets it on their next fetch.",
    tags: ["Cards"],
    auth: true,
    params: { label: LabelParam },
    body: CardJson,
    responses: { 200: { description: "The card", schema: OwnCardJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, params, body }) => ({ status: 200, body: await setOwnCard(viewer, params.label, body) })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/me/cards/{label}`,
    operationId: "deleteOwnCard",
    summary: "Delete one of the caller's own cards",
    description: "Its link stops working; whoever subscribed keeps the card as they last fetched it.",
    tags: ["Cards"],
    auth: true,
    params: { label: LabelParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await deleteOwnCard(viewer, params.label);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/me/cards/{label}/link`,
    operationId: "publishOwnCard",
    summary: "A new secret link to one of the caller's cards",
    description:
      "Served as a vCard at /api/card/{key}.vcf. Anyone with the link can read the card. A new link replaces that card's old one, which stops working; the other cards' links don't change.",
    tags: ["Cards"],
    auth: true,
    params: { label: LabelParam },
    responses: { 200: { description: "The new link", schema: CardLinkJson }, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: { url: cardPath(await publishCard(viewer, params.label)) } })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/me/cards/{label}/link`,
    operationId: "unpublishOwnCard",
    summary: "End the link to one of the caller's cards",
    description: "Whoever subscribed keeps the card as they last fetched it and gets nothing new.",
    tags: ["Cards"],
    auth: true,
    params: { label: LabelParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await unpublishCard(viewer, params.label);
    return { status: 204, body: undefined };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/people/{id}/card`,
    operationId: "subscribeCard",
    summary: "Subscribe a person to the card they gave the user",
    description:
      "Fetches it now and again once a day, from https addresses on the internet only (no redirects). Replaces any card the person had. Shared like the name.",
    tags: ["Cards"],
    auth: true,
    params: { id: IdParam },
    body: CardSubscribeJson,
    responses: { 200: { description: "The card as fetched", schema: PersonCardJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => ({ status: 200, body: await subscribeCard(viewer, params.id, body.url) })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/people/{id}/card`,
    operationId: "unsubscribeCard",
    summary: "Drop a person's card",
    tags: ["Cards"],
    auth: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401 },
  }).handle(async ({ viewer, params }) => {
    await unsubscribeCard(viewer, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "PUT",
    path: `${API_PREFIX}/me/language`,
    operationId: "putLanguage",
    summary: "Change the language the caller sees the app in",
    description:
      "The web app and the caller's notifications (reminders, the calendar feed, the Shortcut's answers) follow it. What is filed keeps the words it was filed in.",
    tags: ["Settings"],
    auth: true,
    params: {},
    body: LanguageJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401 },
  }).handle(async ({ viewer, body }) => {
    await setLanguage(viewer, body.language);
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/me/reflection`,
    operationId: "getReflection",
    summary: "When the caller's weekly reflection is pushed",
    tags: ["Settings"],
    auth: true,
    params: {},
    responses: { 200: { description: "The setting", schema: ReflectionJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { reflection: await getReflection(viewer) } })),

  op({
    method: "PUT",
    path: `${API_PREFIX}/me/reflection`,
    operationId: "putReflection",
    summary: "Turn the weekly reflection on (a day and an hour) or off (null)",
    tags: ["Settings"],
    auth: true,
    params: {},
    body: ReflectionJson,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401 },
  }).handle(async ({ viewer, body }) => {
    await putReflection(viewer, body.reflection);
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
    method: "POST",
    path: `${API_PREFIX}/invitations`,
    operationId: "createInvitation",
    summary: "Invite someone into a book",
    description: "For the book's owner or an admin: a link that works once, for 7 days; whoever opens it joins the book in `role`.",
    tags: ["Books"],
    auth: true,
    params: {},
    body: z.object({ role: z.enum(["member", "admin"]).describe("The role the invited person gets") }),
    responses: {
      201: {
        description: "The invitation; its link is shown only now",
        schema: z.object({ id: z.string(), url: z.string().describe("The link to pass on"), expiresAt: z.number() }),
      },
      400: E400,
      401: E401,
      403: err("Only the book's owner or an admin may invite (`forbidden`)"),
    },
  }).handle(async ({ viewer, body }) => ({ status: 201, body: await invite(viewer, body.role) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/invitations/{token}`,
    operationId: "acceptInvitation",
    summary: "Join a book through an invitation",
    description: "The caller joins the invitation's book in the role it names; the invitation is used up.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: { token: z.string().describe("The invitation's token, from its link") },
    responses: {
      200: { description: "The book joined", schema: z.object({ id: z.string(), name: z.string() }) },
      400: err("The caller is in that book already (`invalid_input`)"),
      401: E401,
      404: err("No such invitation, or it was used, revoked or has expired (`not_found`)"),
    },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await acceptInvitationAs(viewer, params.token) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/books`,
    operationId: "listBooks",
    summary: "The caller's books",
    description: "Oldest first, each with the caller's role and its members.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: {},
    responses: { 200: { description: "The books", schema: z.array(BookViewJson) }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await listBooks(viewer) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/books`,
    operationId: "createBook",
    summary: "A new book of the caller's",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: {},
    body: z.object({ name: z.string() }),
    responses: { 201: { description: "The book, the caller its owner", schema: BookRefJson }, 400: E400, 401: E401 },
  }).handle(async ({ viewer, body }) => ({ status: 201, body: await newBook(viewer, body.name) })),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/books/{id}`,
    operationId: "renameBook",
    summary: "Rename a book",
    description: "For its owner or an admin.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    body: z.object({ name: z.string() }),
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await renameBook(await theBook(viewer, params.id), body.name);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/books/{id}`,
    operationId: "deleteBook",
    summary: "Delete a book and everything in it",
    description: "For its owner, and not their only book. Whoever is left in no book gets an empty one of their own.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await deleteBook(await theBook(viewer, params.id));
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/books/{id}/leave`,
    operationId: "leaveBook",
    summary: "Leave a book",
    description: "Not the owner (they hand it over first), and not the caller's only book. What the caller marked private there is deleted.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await leaveBook(await theBook(viewer, params.id));
    return { status: 204, body: undefined };
  }),

  op({
    method: "GET",
    path: `${API_PREFIX}/books/{id}/invitations`,
    operationId: "listInvitations",
    summary: "A book's invitations that still work",
    description: "For its owner or an admin.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    responses: { 200: { description: "The open invitations", schema: z.array(InvitationJson) }, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params }) => ({ status: 200, body: await listInvitations(await theBook(viewer, params.id)) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/books/{id}/invitations`,
    operationId: "inviteIntoBook",
    summary: "Invite someone into this book",
    description: "Members by the owner or an admin, admins only by the owner: a link that works once, for 7 days.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    body: z.object({ role: z.enum(["member", "admin"]).describe("The role the invited person gets") }),
    responses: {
      201: { description: "The invitation; its link is shown only now", schema: NewInvitationJson },
      400: E400,
      401: E401,
      403: ROLE_403,
      404: E404,
    },
  }).handle(async ({ viewer, params, body }) => ({ status: 201, body: await invite(await theBook(viewer, params.id), body.role) })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/books/{id}/invitations/{invitationId}`,
    operationId: "revokeInvitation",
    summary: "End an invitation",
    description: "Its link stops working. For the book's owner or an admin.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: { ...BOOK_ID, invitationId: z.string() },
    responses: { 204: NO_CONTENT, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await revokeInvitation(await theBook(viewer, params.id), params.invitationId);
    return { status: 204, body: undefined };
  }),

  op({
    method: "PATCH",
    path: `${API_PREFIX}/books/{id}/members/{userId}`,
    operationId: "setMemberRole",
    summary: "Make a member an admin, or an admin a member",
    description: "For the book's owner; the owner's own role changes only by handing the book over.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: { ...BOOK_ID, userId: z.string().describe("The member's user id") },
    body: z.object({ role: z.enum(["admin", "member"]) }),
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await setRole(await theBook(viewer, params.id), params.userId, body.role);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/books/{id}/members/{userId}`,
    operationId: "removeMember",
    summary: "Remove someone from a book",
    description: "For the owner (anyone but themselves) or an admin (members only). What they marked private there is deleted.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: { ...BOOK_ID, userId: z.string().describe("The member's user id") },
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await removeMember(await theBook(viewer, params.id), params.userId);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/books/{id}/owner`,
    operationId: "handOverBook",
    summary: "Hand a book over to another member",
    description: "For its owner, who stays as an admin.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: BOOK_ID,
    body: z.object({ userId: z.string().describe("The new owner's user id") }),
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 403: ROLE_403, 404: E404 },
  }).handle(async ({ viewer, params, body }) => {
    await handOver(await theBook(viewer, params.id), body.userId);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/people/{id}/move`,
    operationId: "movePerson",
    summary: "Move someone into another of the caller's books",
    description:
      "With what is filed about them, under a new id. An entry stays in the old book (`remains`) while another member's private item there still points at them.",
    tags: ["Books"],
    auth: true,
    allBooks: true,
    params: { id: z.string().describe("The person's id") },
    body: z.object({ to: z.string().describe("The book to move them into, by id or name") }),
    responses: { 200: { description: "Who moved, with the new ids", schema: MovedJson }, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params, body }) => ({ status: 200, body: await movePeople(viewer, [params.id], body.to) })),

  op({
    method: "GET",
    path: `${API_PREFIX}/files`,
    operationId: "listPendingFiles",
    summary: "The caller's shared files that wait for them",
    description: "Being read, waiting for a decision, or failed; newest first. Only the caller's own: the other user's never show.",
    tags: ["Files"],
    auth: true,
    allBooks: true,
    params: {},
    responses: { 200: { description: "Waiting files", schema: PendingFileListJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: await listPending(viewer) })),

  op({
    method: "POST",
    path: `${API_PREFIX}/files/{id}/done`,
    operationId: "closeFile",
    summary: "Close a waiting file as worked through",
    description: "For a file with nothing worth filing: it is deleted, like a discarded one. Filing a conversation with fileIds closes it on its own.",
    tags: ["Files"],
    auth: true,
    allBooks: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await discardFile(viewer, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/files/{id}/retry`,
    operationId: "retryFile",
    summary: "Read a failed file again",
    tags: ["Files"],
    auth: true,
    allBooks: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 400: E400, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    const model = fileModel();
    if (!model) throw new NotFoundError("Sharing files is off on this instance");
    await retryFile(viewer, params.id, model);
    return { status: 204, body: undefined };
  }),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/files/{id}`,
    operationId: "discardFile",
    summary: "Throw a waiting file away",
    tags: ["Files"],
    auth: true,
    allBooks: true,
    params: { id: IdParam },
    responses: { 204: NO_CONTENT, 401: E401, 404: E404 },
  }).handle(async ({ viewer, params }) => {
    await discardFile(viewer, params.id);
    return { status: 204, body: undefined };
  }),

  op({
    method: "POST",
    path: `${API_PREFIX}/me/share-key`,
    operationId: "createShareKey",
    summary: "A new share key for the iPhone Shortcut",
    description: "The key can only hand in files (POST /api/share). A new one replaces the old one.",
    tags: ["Files"],
    auth: true,
    params: {},
    responses: { 200: { description: "The new key", schema: ShareKeyJson }, 401: E401 },
  }).handle(async ({ viewer }) => ({ status: 200, body: { key: await createShareKey(viewer) } })),

  op({
    method: "DELETE",
    path: `${API_PREFIX}/me/share-key`,
    operationId: "revokeShareKey",
    summary: "Turn the caller's share key off",
    tags: ["Files"],
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

// Every signed-in request runs in one book: the book of the ids in its path, else `?book=`, else the user's oldest. A book the
// user isn't in is 404 like anything else they can't see.
const BOOK_404 = err("No such thing, or one the caller may not see; or no book of the caller's by the name or id in `book` (`not_found`)");
const OPS: AnyOp[] = ROUTES.map((o) => (o.auth ? { ...o, responses: { 404: BOOK_404, ...o.responses } } : o));

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
      ...(entry.auth && !entry.allBooks && !Object.keys(entry.params).length
        ? [
            {
              name: "book",
              in: "query",
              required: false,
              description: "The book to work in, by name or id; without one, the caller's oldest book",
              schema: { type: "string" },
            },
          ]
        : []),
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
        'Every error is JSON, `{"error": "...", "code": "..."}`. Besides the responses listed per operation, ' +
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
      { name: "Cards", description: "Own cards: what a person says about themselves, shared by a secret link and subscribed to for a person (ADR 0024)." },
      { name: "Calendar", description: "The secret URL of the caller's calendar feed (ICS), served at /api/calendar/{key}.ics." },
      { name: "Meta", description: "About the API itself." },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An OAuth access token issued for this API's URL (`/api/v1`)" },
        cookie: {
          type: "apiKey",
          in: "cookie",
          name: IDENTITY_COOKIE,
          description: "The browser's sign-in; on anything but a GET only from the app's own pages",
        },
      },
    },
  };
}
