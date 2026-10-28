// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them. The
// vocabularies come from backend/types.ts; the rules on the values stay in the domain functions,
// which answer a bad value with `invalid_input`.
import * as z from "zod";
import { CONVERSATION_KINDS, EXCHANGE_KINDS, FACT_CATEGORIES, FACT_KINDS, GENDERS, VISIBILITIES } from "../types";
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

export const Gender = z.enum(GENDERS).describe("The person's gender, which the role labels follow; set only when the user states it or uses a pronoun for the person, never from the name");
/** A relationship's end: a person, or the household. */
/** The words of a relationship, written by Claude in each end's gender: there is no fixed list of types. */
export const LABEL = z.string().describe("What `from` is to `to`, in words and in from's gender: Vermieterin, Sohn, Kollege, Nachbar:in (unknown gender)");
export const INVERSE = z.string().describe("What `to` is to `from`, the same way: Mieter, Mutter, Kollegin, Nachbar:in");
export const HOUSEHOLD_TARGET = z.enum(["me", "us"]).describe('"me": the user\'s own person; "us": everyone in the household, one relationship each');
export const PersonJson = z
  .object({
    id: PersonId,
    name: z.string(),
    aliases: z.array(z.string()),
    url: Url,
    createdFrom: z.string().nullable().optional().describe("The conversation the person was first mentioned in, when the viewer may see it; absent in a search"),
    context: z.array(z.string()).optional().describe("Only in a search: short hints that tell people with the same name apart"),
    gender: Gender.nullable().optional().describe("null when it isn't known; absent in a search"),
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
const Own = { visibility: Visibility, mine: z.boolean().describe("Whether the caller recorded it; only then may they change its visibility. A shared item either user may edit or delete") };

const FactJson = {
  id: z.string(),
  text: z.string(),
  category: z.enum(FACT_CATEGORIES),
  url: ItemUrl,
  source: z.string().optional().describe("Where it was posted (Instagram, LinkedIn, ...), for a fact read from a shared screenshot"),
  happenedOn: Day.optional().describe("When it happened, when the screenshot showed it"),
  imageUrl: Url.optional().describe("The screenshot it was read from (sign-in required)"),
  ...Own,
};

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
      gender: Gender.nullable().describe("null when it isn't known"),
    }),
    roles: z
      .array(
        z.object({
          label: z.string().describe("What the person is to the household, in the words filed: Vermieterin, Ärztin, Klempner"),
          with: z.enum(["me", "partner", "us"]).describe("To whom, from the caller's side: `us` both of the household, `me` the caller, `partner` the other user"),
          partnerName: z.string().optional().describe("The other user's name, when `with` is `partner`"),
          ids: z.array(z.string()).describe("The relationships it stands for (table `relationships`), one per household person"),
        }),
      )
      .describe("Who the person is to the household (\"your landlady\", \"Sybille's colleague\"): the first thing to say about them"),
    groups: z.array(z.object({ id: z.string(), name: z.string(), url: Url, private: z.boolean().describe("Whether the caller's own private membership is the only one they see") })).describe("The groups the caller may see the person in, each once"),
    freshness: Freshness,
    nextDates: z.array(UpcomingDate),
    situations: z
      .array(
        z.object({
          ...FactJson,
          since: Day.describe("When the latest news about it was filed"),
          checkAfter: Day.describe("When to ask how it went"),
          nudge: z.boolean().describe("checkAfter has come: ask about it"),
        }),
      )
      .describe("What is going on and will end, nudging ones first: the best things to ask about"),
    known: z.array(z.object(FactJson)).describe("What stays true about the person, by category"),
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
        label: z.string().describe("What `from` is to `to`, as stored"),
        inverse: z.string().describe("What `to` is to `from`, as stored"),
        note: z.string().nullable(),
        ...Own,
        direction: z.enum(["out", "in"]).describe("`out` when the person is `from` (so `inverse` is what the other is to them), `in` when they are `to` (`label` is)"),
        url: Url.describe("The other person's page, as an absolute URL"),
      }),
    ),
    network: z
      .object({
        nodes: z.array(
          z.object({
            id: PersonId,
            name: z.string(),
            gender: Gender.nullable(),
            role: z.enum(["self", "household", "other"]).describe("`self` the person, `household` one of us, `other` the person's own people"),
            url: Url,
          }),
        ),
        edges: z.array(z.object({ id: z.string(), from: PersonId, to: PersonId, label: z.string().describe("What `from` is to `to`"), inverse: z.string().describe("What `to` is to `from`") })),
      })
      .describe("One hop around the person: the household persons they relate to, and their own people"),
    suggestedInterval: z.number().int().optional().describe("Only while the interval isn't confirmed, only when the history is long enough to suggest one, and never for one of the household"),
  })
  .meta({ id: "Briefing" });

export const DueItemJson = z
  .object({
    kind: z.enum(["date", "promise", "overdue", "situation"]).describe("`situation`: something going on whose checkAfter has come; ask how it went"),
    personId: PersonId,
    name: z.string(),
    date: z.string().optional(),
    text: z.string().optional(),
    ratio: z.number().optional(),
    byMe: z.boolean().optional().describe("On a promise: whether the caller made it (false: the person promised it to the caller). Only the caller's own promises are due"),
    itemId: z.string().optional().describe("On a date, a promise or a situation (a fact): its id"),
    lastSeen: z.string().nullable().optional().describe("On someone overdue: the day the caller last saw them"),
    intervalDays: z.number().int().nullable().optional().describe("On someone overdue: the caller's check-in interval"),
    url: Url.describe("The person's page, as an absolute URL; for a date, a promise or a situation, its highlighted row there"),
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

export const PersonPatchJson = z
  .object({ name: z.string().optional().describe("The person's new name"), gender: Gender.nullable().optional().describe("The person's gender; null clears it") })
  .refine((p) => p.name !== undefined || p.gender !== undefined, "Give a name, a gender, or both")
  .meta({ id: "PersonPatch" });

export const FactRelationshipJson = z
  .object({
    from: z.union([PersonId, HOUSEHOLD_TARGET]),
    to: z.union([PersonId, HOUSEHOLD_TARGET]),
    label: LABEL,
    inverse: INVERSE,
    note: z.string().optional(),
  })
  .describe("The relationship a fact becomes; one end is the fact's person")
  .meta({ id: "FactRelationship" });
export const RelationshipIdsJson = z.object({ ids: z.array(z.string()).describe('One per pair; "us" is one per household person') }).meta({ id: "RelationshipIds" });

export const AliasJson = z.object({ alias: z.string().describe("Another name the person goes by, e.g. a nickname") }).meta({ id: "Alias" });

// A conversation as it is recorded. `people` entries are referred to by their index in the other lists.
const Ref = z.number().int().describe("An index into `people`");
export const FactKind = z
  .enum(FACT_KINDS)
  .describe(
    "`situation`: going on and will end (moving, a new dog, looking for a car, angry about the new job); `lasting` (default): stays true (works at Hornbach). The traits, which last and have no checkAfter: `need`: something to plan around when meeting or inviting them (needs a wheelchair, vegetarian, nut allergy, doesn't drink); `personality`: how the person is and how to deal with them (gets angry quickly, shy in big groups, hates phone calls). A fact that supersedes another keeps its kind unless given",
  );
export const CheckAfter = Day.describe(
  "situation only: the day to ask how it went, estimated from how long it usually takes (a car: a few weeks, a house: months); six weeks after filing when left out; news that supersedes a situation must give a new one",
);
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
        gender: Gender.optional(),
      }),
    ),
    facts: z
      .array(
        z.object({
          person: Ref,
          text: z.string(),
          category: z.enum(FACT_CATEGORIES),
          private: Private,
          supersedes: z.string().optional().describe("The id of the fact this replaces: news about a situation, or a lasting fact that ends it"),
          kind: FactKind.optional(),
          checkAfter: CheckAfter.optional(),
        }),
      )
      .optional(),
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
    relationships: z
      .array(
        z.object({
          from: z.union([Ref, HOUSEHOLD_TARGET]),
          to: z.union([Ref, HOUSEHOLD_TARGET]),
          label: LABEL,
          inverse: INVERSE,
          note: z.string().optional().describe("Anything more about it: \"seit der Schulzeit\""),
          private: Private,
        }),
      )
      .optional()
      .describe('How people are related, and who someone is to the household: a role ("our landlady") goes to "us" or "me", never into a fact'),
    groups: z.array(z.object({ name: z.string(), members: z.array(Ref), private: Private })).optional(),
  })
  .meta({ id: "NewConversation" });

// What a write filed, item by item: only the caller's own rows, or (a relationship that was there) one they may see.
const Filed = {
  id: z.string(),
  personId: PersonId,
  name: z.string().describe("The name of the person it is about"),
  visibility: Visibility,
  url: ItemUrl,
};
export const FiledItemsJson = z.object({
  facts: z.array(
    z.object({
      ...Filed,
      text: z.string(),
      kind: z.enum(FACT_KINDS),
      checkAfter: Day.nullable().describe("A situation's day to ask how it went; null for a lasting fact"),
      defaultCheckAfter: z.boolean().describe("Whether the server chose checkAfter, six weeks from now, because none was given"),
      supersedes: z.string().nullable().describe("The fact it replaced, now outdated"),
    }),
  ),
  promises: z.array(z.object({ ...Filed, text: z.string(), byMe: z.boolean(), due: Day.nullable() })),
  dates: z.array(z.object({ ...Filed, kind: z.enum(["birthday", "anniversary", "custom"]), date: z.string(), label: z.string().nullable(), yearly: z.boolean() })),
  exchanges: z.array(z.object({ ...Filed, kind: z.enum(EXCHANGE_KINDS), direction: Direction, text: z.string() })),
});
export const FiledRelationshipJson = z.object({
  id: z.string(),
  fromId: PersonId,
  fromName: z.string(),
  toId: PersonId,
  toName: z.string(),
  label: z.string().describe("What from is to to, as stored: an existing relationship keeps its own words"),
  inverse: z.string().describe("What to is to from, as stored"),
  created: z.boolean().describe("false when the caller already saw the same relationship, which was kept as it was"),
  url: ItemUrl.describe("Its highlighted row on the page of from (of to when from is the household), as an absolute URL"),
});

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
    filed: FiledItemsJson.extend({
      relationships: z.array(FiledRelationshipJson).describe('One per pair: "us" is one per household person'),
      groups: z.array(
        z.object({
          id: z.string(),
          name: z.string().describe("The group's own name; the name given may have been another name of it"),
          added: z.number().int(),
          already: z.number().int().describe("How many of the members the caller had put in it before"),
          url: Url,
        }),
      ),
    }).describe("Everything filed, with ids and links"),
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
    relationships: z.array(z.object({ ...Item, fromId: PersonId, fromName: z.string(), toId: PersonId, toName: z.string(), label: z.string(), inverse: z.string(), note: z.string().nullable() })),
  })
  .meta({ id: "Conversation" });

export const ItemPatchJson = z
  .object({
    done: z.literal(true).optional().describe("Marks a promise done or an exchange settled"),
    outdated: z.literal(true).optional().describe("Marks a fact outdated"),
    visibility: Visibility.optional().describe("Changes who can see the item (only its recorder may)"),
    patch: z.record(z.string(), z.unknown()).optional().describe("New values for the item's own fields (its recorder, or either user for a shared item; a conversation only its recorder)"),
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

export const COMPONENTS = [PendingScreenshotListJson, ResolutionJson, ResolvedJson, ShareKeyJson, CalendarFeedJson, PersonPatchJson, FactRelationshipJson, RelationshipIdsJson, GroupJson, GroupListJson, GroupDetailJson, GroupNameJson, GroupMergeJson, SettingsJson, SentJson, ErrorJson, PersonJson, PersonListJson, BriefingJson, DueItemJson, DueListJson, OrbitFaceJson, OrbitJson, IntervalJson, MergeJson, AliasJson, NewConversationJson, RecordedJson, ConversationJson, ItemPatchJson];

export const IdParam = z.string().describe("The id");
export const TableParam = z.string().describe("The kind of item: `facts`, `promises`, `dates`, `exchanges`, `relationships` or `conversations`");
export const PeopleQuery = z.object({ q: z.string().optional().describe("A name or alias to search for; best matches first, at most 5. Without it, every person") });
