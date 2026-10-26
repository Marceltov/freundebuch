// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them. The
// vocabularies come from backend/types.ts; the rules on the values stay in the domain functions,
// which answer a bad value with `invalid_input`.
import * as z from "zod";
import { CONVERSATION_KINDS, EXCHANGE_KINDS, FACT_CATEGORIES, RELATIONSHIP_TYPES, VISIBILITIES } from "../types";
import { ERROR_CODES } from "./errors";

export const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).describe("Stable machine-readable code"),
  })
  .meta({ id: "Error" });

export const Visibility = z.enum(VISIBILITIES).describe("`private` items are visible only to whoever recorded them");
export const Day = z.string().describe("A day, `YYYY-MM-DD`");
export const PersonId = z.string().describe("A person's id");
const Url = z.string().describe("Where it opens in the web app, as an absolute URL");
// An item links to its row on the page that shows it, which scrolls to the row and highlights it.
const ItemUrl = Url.describe("Where it opens in the web app, as an absolute URL to its highlighted row");

export const PersonJson = z
  .object({
    id: PersonId,
    name: z.string(),
    aliases: z.array(z.string()),
    url: Url,
    createdFrom: z.string().nullable().optional().describe("The conversation the person was first mentioned in, when the viewer may see it; absent in a search"),
    context: z.array(z.string()).optional().describe("Only in a search: short hints that tell people with the same name apart"),
  })
  .meta({ id: "Person" });

const Freshness = z.object({
  lastSeen: z.string().nullable().describe("The day of the latest conversation the person was present at"),
  intervalDays: z.number().int().nullable().describe("The viewer's check-in interval for the person"),
  ratio: z.number().nullable().describe("Days since last seen divided by the interval; 1 means the check-in falls due today"),
});

const UpcomingDate = z.object({
  id: z.string(),
  personId: PersonId,
  kind: z.enum(["birthday", "anniversary", "custom"]),
  label: z.string().nullable(),
  date: Day.describe("The day it falls on next"),
  inDays: z.number().int(),
  age: z.number().int().nullable().describe("The age reached, for a birthday with a year"),
  url: ItemUrl,
});

const Direction = z.enum(["to_them", "from_them"]);
// Promises and exchanges read from the caller's side; one the other user made or recorded names them.
const ByMe = z.boolean().describe("Whether the caller made the promise");
const PromiseBy = z.string().optional().describe("The other user's name, when they made the promise; with neither, the person made it");
const ExchangeBy = z.string().optional().describe("The other user's name, when they recorded it; `direction` then reads from their side");
const ExchangeDirection = Direction.describe("`to_them`: the caller (or `by`) gave to the person; `from_them`: the person gave");
const Own = { visibility: Visibility, mine: z.boolean().describe("Whether the caller recorded it; only then may they edit it, change its visibility or delete it") };

export const BriefingJson = z
  .object({
    person: z.object({
      id: PersonId,
      name: z.string(),
      aliases: z.array(z.string()),
      url: Url,
      birthday: z
        .object({
          id: z.string().describe("The date's id"),
          date: z.string().describe("As recorded: `YYYY-MM-DD`, or `--MM-DD` without a year"),
          next: Day.describe("The day it falls on next"),
          age: z.number().int().nullable().describe("The age reached then, when the year is known"),
        })
        .nullable()
        .describe("The person's birthday as the caller may see it, however far away"),
    }),
    groups: z.array(z.object({ id: z.string(), name: z.string(), url: Url, private: z.boolean().describe("Whether the caller's own private membership is the only one they see") })).describe("The groups the caller may see the person in, each once"),
    freshness: Freshness,
    nextDates: z.array(UpcomingDate),
    current: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        category: z.enum(FACT_CATEGORIES),
        url: ItemUrl,
        source: z.string().optional().describe("Where it was posted (Instagram, LinkedIn, ...), for a fact read from a shared screenshot"),
        happenedOn: Day.optional().describe("When it happened, when the screenshot showed it"),
        imageUrl: Url.optional().describe("The screenshot it was read from (sign-in required)"),
        ...Own,
      }),
    ),
    open: z.object({
      promises: z.array(z.object({ id: z.string(), text: z.string(), byMe: ByMe, by: PromiseBy, due: z.string().nullable(), url: ItemUrl, ...Own })),
      exchanges: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(EXCHANGE_KINDS),
          direction: ExchangeDirection,
          by: ExchangeBy,
          text: z.string(),
          amount: z.number().nullable(),
          currency: z.string().nullable(),
          url: ItemUrl,
          ...Own,
        }),
      ),
      giftIdeas: z.array(z.object({ id: z.string(), text: z.string(), url: ItemUrl, ...Own })),
    }),
    recent: z.array(z.object({ id: z.string(), date: Day, kind: z.string(), summary: z.string(), withOthers: z.array(z.string()), url: Url })),
    relationships: z.array(
      z.object({
        id: z.string().describe("The relationship's id, for correct/the items operations (table `relationships`)"),
        personId: PersonId,
        name: z.string(),
        type: z.enum(RELATIONSHIP_TYPES),
        note: z.string().nullable().describe("What the relationship is, in words, above all for `other` (\"Patentante\")"),
        ...Own,
        direction: z.enum(["out", "in"]).describe("`out` when the person is the `from` side of the relationship"),
        url: Url.describe("The other person's page, as an absolute URL"),
      }),
    ),
    suggestedInterval: z.number().int().optional().describe("Only while the interval isn't confirmed, and only when the history is long enough to suggest one"),
  })
  .meta({ id: "Briefing" });

export const DueItemJson = z
  .object({
    kind: z.enum(["date", "promise", "overdue"]),
    personId: PersonId,
    name: z.string(),
    date: z.string().optional(),
    text: z.string().optional(),
    ratio: z.number().optional(),
    byMe: z.boolean().optional().describe("On a promise: whether the caller made it (false: the person promised it to the caller). Only the caller's own promises are due"),
    itemId: z.string().optional().describe("On a date or a promise: its id"),
    lastSeen: z.string().nullable().optional().describe("On someone overdue: the day the caller last saw them"),
    intervalDays: z.number().int().nullable().optional().describe("On someone overdue: the caller's check-in interval"),
    url: Url.describe("The person's page, as an absolute URL; for a date or a promise, its highlighted row there"),
  })
  .meta({ id: "DueItem" });

export const OrbitFaceJson = z
  .object({
    personId: PersonId,
    name: z.string(),
    ring: z.union([z.literal(0), z.literal(1), z.literal(2)]).describe("0 seen recently, 1 drifting, 2 due or overdue, by the caller's own last seen and interval"),
    angle: z.number().describe("Where on its ring, in degrees; stable for a person and spread evenly within the ring"),
    badges: z.array(z.enum(["birthday", "promise", "gift"])).describe("A birthday within 14 days, an open promise, a gift idea"),
    url: Url,
    inGroup: z.boolean().optional().describe("Only with a group filter: whether the person is in that group"),
    unseen: z.boolean().optional().describe("The caller never met them; they fill free places on the outer ring"),
  })
  .meta({ id: "OrbitFace" });

export const IntervalJson = z
  .object({
    days: z.number().int().nullable().describe("Days between check-ins; null for no check-in wanted"),
    confirmed: z.boolean().default(false).describe("Whether the viewer agreed to this interval, as opposed to accepting a default"),
  })
  .meta({ id: "Interval" });

export const MergeJson = z.object({ drop: PersonId.describe("The duplicate to merge into the person in the path; it is deleted") }).meta({ id: "Merge" });

export const PersonNameJson = z.object({ name: z.string().describe("The person's new name") }).meta({ id: "PersonName" });

export const AliasJson = z.object({ alias: z.string().describe("Another name the person goes by, e.g. a nickname") }).meta({ id: "Alias" });

// A conversation as it is recorded. `people` entries are referred to by their index in the other lists.
const Ref = z.number().int().describe("An index into `people`");
const Private = z.boolean().optional().describe("Makes just this item private; a private conversation makes every item private");

export const NewConversationJson = z
  .object({
    date: Day,
    kind: z.enum(CONVERSATION_KINDS),
    place: z.string().optional(),
    summary: z.string(),
    transcript: z.string().describe("The verbatim text; private to the recorder whenever anything recorded with it is private"),
    visibility: Visibility,
    people: z.array(
      z.object({
        id: PersonId.optional().describe("An existing person"),
        name: z.string().optional().describe("A new person"),
        aliases: z.array(z.string()).optional(),
        present: z.boolean().describe("Whether the person took part"),
        confirmedNew: z
          .boolean()
          .optional()
          .describe("A new person whose name matches an existing person's name or alias: only once the user confirmed it is someone else; otherwise `ambiguous`"),
      }),
    ),
    facts: z.array(z.object({ person: Ref, text: z.string(), category: z.enum(FACT_CATEGORIES), private: Private, supersedes: z.string().optional().describe("The id of the fact this replaces") })).optional(),
    promises: z.array(z.object({ person: Ref, text: z.string(), byMe: z.boolean(), due: Day.optional(), private: Private })).optional(),
    dates: z
      .array(
        z.object({
          person: Ref,
          kind: z.enum(["birthday", "anniversary", "custom"]),
          date: z.string().describe("`YYYY-MM-DD`, or `--MM-DD` for a yearly date without a year"),
          label: z.string().optional(),
          yearly: z.boolean(),
          private: Private,
        }),
      )
      .optional(),
    exchanges: z
      .array(z.object({ person: Ref, kind: z.enum(EXCHANGE_KINDS), direction: Direction, text: z.string(), amount: z.number().optional(), currency: z.string().optional(), private: Private }))
      .optional(),
    relationships: z.array(z.object({ from: Ref, to: Ref, type: z.enum(RELATIONSHIP_TYPES), note: z.string().optional(), private: Private })).optional(),
    groups: z.array(z.object({ name: z.string(), members: z.array(Ref), private: Private })).optional(),
  })
  .meta({ id: "NewConversation" });

export const RecordedJson = z
  .object({
    conversationId: z.string(),
    url: Url.describe("The conversation's page, which lists everything filed from it, as an absolute URL"),
    people: z.array(z.object({ ref: Ref, id: PersonId, name: z.string(), created: z.boolean(), url: Url })),
    counts: z.object({
      facts: z.number().int(),
      promises: z.number().int(),
      dates: z.number().int(),
      exchanges: z.number().int(),
      relationships: z.number().int(),
      groups: z.number().int().describe("The group memberships written"),
    }),
  })
  .meta({ id: "Recorded" });

const Name = z.string().describe("The name of the person it is about");
const Item = { id: z.string(), visibility: Visibility, recordedBy: z.string().describe("The id of the user who recorded it"), url: ItemUrl.describe("Its highlighted row on the conversation's page, as an absolute URL") };

export const ConversationJson = z
  .object({
    id: z.string(),
    date: Day,
    kind: z.enum(CONVERSATION_KINDS),
    place: z.string().nullable(),
    summary: z.string(),
    transcript: z.string().nullable().describe("Null when the viewer may not read it"),
    visibility: Visibility,
    recordedBy: z.string(),
    url: Url,
    participants: z.array(z.object({ id: PersonId, name: z.string(), url: Url })),
    facts: z.array(z.object({ ...Item, personId: PersonId, name: Name, text: z.string(), category: z.enum(FACT_CATEGORIES), status: z.enum(["current", "outdated"]) })),
    promises: z.array(z.object({ ...Item, personId: PersonId, name: Name, text: z.string(), byMe: ByMe, by: PromiseBy, due: z.string().nullable(), done: z.boolean() })),
    dates: z.array(z.object({ ...Item, personId: PersonId, name: Name, kind: z.enum(["birthday", "anniversary", "custom"]), date: z.string(), label: z.string().nullable(), yearly: z.boolean() })),
    exchanges: z.array(
      z.object({
        ...Item,
        personId: PersonId,
        name: Name,
        kind: z.enum(EXCHANGE_KINDS),
        direction: ExchangeDirection,
        by: ExchangeBy,
        text: z.string(),
        amount: z.number().nullable(),
        currency: z.string().nullable(),
        settled: z.boolean(),
      }),
    ),
    relationships: z.array(z.object({ ...Item, fromId: PersonId, fromName: z.string(), toId: PersonId, toName: z.string(), type: z.enum(RELATIONSHIP_TYPES), note: z.string().nullable() })),
  })
  .meta({ id: "Conversation" });

export const ItemPatchJson = z
  .object({
    done: z.literal(true).optional().describe("Marks a promise done or an exchange settled"),
    outdated: z.literal(true).optional().describe("Marks a fact outdated"),
    visibility: Visibility.optional().describe("Changes who can see the item (only its recorder may)"),
    patch: z.record(z.string(), z.unknown()).optional().describe("New values for the item's own fields (only its recorder may)"),
    transcriptShared: z
      .literal(true)
      .optional()
      .describe("Lets the partner read a conversation's transcript (only its recorder may, and only once neither it nor anything recorded with it is private)"),
  })
  .describe("Exactly one of the five")
  .meta({ id: "ItemPatch" });

// A list of components is a component too: the generator only resolves a $ref at the top of a schema.
export const PersonListJson = z.array(PersonJson).meta({ id: "PersonList" });

export const GroupJson = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()).describe("Other names that find the group, e.g. Kollegen for Arbeit"),
    count: z.number().int().describe("How many people the caller may see in it"),
    url: Url,
  })
  .meta({ id: "Group" });
export const GroupListJson = z.array(GroupJson).meta({ id: "GroupList" });
export const GroupDetailJson = GroupJson.extend({
  members: z.array(
    z.object({
      personId: PersonId,
      name: z.string(),
      url: Url,
      private: z.boolean().describe("Whether the caller's own private membership is the only one they see"),
      lastSeen: z.string().nullable(),
      ratio: z.number().nullable().describe("Days since last seen divided by the caller's interval"),
    }),
  ),
}).meta({ id: "GroupDetail" });
export const GroupNameJson = z.object({ name: z.string().describe("A group's name; one that already names a group finds that group") }).meta({ id: "GroupName" });
export const GroupMergeJson = z.object({ drop: z.string().describe("The group to merge into the one in the path; it is deleted") }).meta({ id: "GroupMerge" });
export const DueListJson = z.array(DueItemJson).meta({ id: "DueList" });
export const OrbitJson = z.array(OrbitFaceJson).meta({ id: "Orbit" });

export const SettingsJson = z
  .object({ webhookUrl: z.url({ protocol: /^https?$/ }).nullable().describe("Where the daily reminders are POSTed (ntfy-compatible); null for none. Only http and https") })
  .meta({ id: "Settings" });

export const SentJson = z.object({ sent: z.boolean().describe("Whether the receiver accepted the message") }).meta({ id: "Sent" });

const Candidate = z.object({ id: z.string(), name: Name, url: Url });
export const PendingScreenshotListJson = z
  .array(
    z.object({
      id: z.string(),
      status: z.enum(["reading", "pending", "failed"]).describe("`reading`: Claude is on it; `pending`: waits for the caller to decide; `failed`: couldn't be read (retry or discard)"),
      createdAt: z.number().int().describe("When it was shared, ms since the epoch"),
      imageUrl: Url.describe("The screenshot (sign-in required)"),
      reading: z
        .object({
          kind: z.enum(["post", "nothing"]),
          platform: z.string().nullable(),
          text: z.string(),
          category: z.enum(FACT_CATEGORIES),
          happenedOn: Day.nullable(),
          sensitive: z.boolean(),
          people: z.array(z.object({ name: z.string(), handle: z.string().optional(), person: Candidate.nullable(), candidates: z.array(Candidate) })),
        })
        .nullable()
        .describe("What Claude read; null while reading or when it failed"),
    }),
  )
  .meta({ id: "PendingScreenshotList" });

export const ResolutionJson = z
  .object({
    personId: z.string().optional().describe("The person it is about"),
    name: z.string().optional().describe("Or the name of a new person"),
    text: z.string().optional().describe("Replaces what Claude read"),
    visibility: z.enum(VISIBILITIES).optional().describe("Default shared"),
  })
  .meta({ id: "Resolution" });

export const ResolvedJson = z.object({ factId: z.string(), personId: z.string(), url: ItemUrl }).meta({ id: "Resolved" });
export const ShareKeyJson = z.object({ key: z.string().describe("The share key; shown only now. Send it as `Authorization: Bearer <key>` to /api/share") }).meta({ id: "ShareKey" });

export const CalendarFeedJson = z
  .object({
    active: z.boolean().describe("Whether the user has a calendar feed now"),
    created: z.boolean().describe("Whether this call made a new feed URL; any earlier one stopped working"),
    url: z
      .string()
      .nullable()
      .describe("The new feed URL, as an absolute URL, only when created; freundebuch keeps only its hash and can't show an existing one again"),
  })
  .meta({ id: "CalendarFeed" });

export const COMPONENTS = [PendingScreenshotListJson, ResolutionJson, ResolvedJson, ShareKeyJson, CalendarFeedJson, PersonNameJson, GroupJson, GroupListJson, GroupDetailJson, GroupNameJson, GroupMergeJson, SettingsJson, SentJson, ErrorJson, PersonJson, PersonListJson, BriefingJson, DueItemJson, DueListJson, OrbitFaceJson, OrbitJson, IntervalJson, MergeJson, AliasJson, NewConversationJson, RecordedJson, ConversationJson, ItemPatchJson];

export const IdParam = z.string().describe("The id");
export const TableParam = z.string().describe("The kind of item: `facts`, `promises`, `dates`, `exchanges`, `relationships` or `conversations`");
export const PeopleQuery = z.object({ q: z.string().optional().describe("A name or alias to search for; best matches first, at most 5. Without it, every person") });
