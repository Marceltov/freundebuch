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

export const PersonJson = z
  .object({
    id: PersonId,
    name: z.string(),
    aliases: z.array(z.string()),
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
});

const Direction = z.enum(["to_them", "from_them"]);

export const BriefingJson = z
  .object({
    person: z.object({ id: PersonId, name: z.string(), aliases: z.array(z.string()) }),
    freshness: Freshness,
    nextDates: z.array(UpcomingDate),
    current: z.array(z.object({ id: z.string(), text: z.string(), category: z.enum(FACT_CATEGORIES) })),
    open: z.object({
      promises: z.array(z.object({ id: z.string(), text: z.string(), byMe: z.boolean(), due: z.string().nullable() })),
      exchanges: z.array(
        z.object({ id: z.string(), kind: z.enum(EXCHANGE_KINDS), direction: Direction, text: z.string(), amount: z.number().nullable(), currency: z.string().nullable() }),
      ),
      giftIdeas: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
    recent: z.array(z.object({ id: z.string(), date: Day, kind: z.string(), summary: z.string(), withOthers: z.array(z.string()) })),
    relationships: z.array(
      z.object({
        personId: PersonId,
        name: z.string(),
        type: z.enum(RELATIONSHIP_TYPES),
        direction: z.enum(["out", "in"]).describe("`out` when the person is the `from` side of the relationship"),
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
  })
  .meta({ id: "DueItem" });

export const IntervalJson = z
  .object({
    days: z.number().int().nullable().describe("Days between check-ins; null for no check-in wanted"),
    confirmed: z.boolean().default(false).describe("Whether the viewer agreed to this interval, as opposed to accepting a default"),
  })
  .meta({ id: "Interval" });

export const MergeJson = z.object({ drop: PersonId.describe("The duplicate to merge into the person in the path; it is deleted") }).meta({ id: "Merge" });

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
    people: z.array(z.object({ ref: Ref, id: PersonId, name: z.string(), created: z.boolean() })),
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

const Item = { id: z.string(), visibility: Visibility, recordedBy: z.string().describe("The id of the user who recorded it") };

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
    participants: z.array(z.object({ id: PersonId, name: z.string() })),
    facts: z.array(z.object({ ...Item, personId: PersonId, text: z.string(), category: z.enum(FACT_CATEGORIES), status: z.enum(["current", "outdated"]) })),
    promises: z.array(z.object({ ...Item, personId: PersonId, text: z.string(), byMe: z.boolean(), due: z.string().nullable(), done: z.boolean() })),
    dates: z.array(z.object({ ...Item, personId: PersonId, kind: z.enum(["birthday", "anniversary", "custom"]), date: z.string(), label: z.string().nullable(), yearly: z.boolean() })),
    exchanges: z.array(
      z.object({ ...Item, personId: PersonId, kind: z.enum(EXCHANGE_KINDS), direction: Direction, text: z.string(), amount: z.number().nullable(), currency: z.string().nullable(), settled: z.boolean() }),
    ),
    relationships: z.array(z.object({ ...Item, fromId: PersonId, toId: PersonId, type: z.enum(RELATIONSHIP_TYPES), note: z.string().nullable() })),
  })
  .meta({ id: "Conversation" });

export const ItemPatchJson = z
  .object({
    done: z.literal(true).optional().describe("Marks a promise done or an exchange settled"),
    outdated: z.literal(true).optional().describe("Marks a fact outdated"),
    visibility: Visibility.optional().describe("Changes who can see the item (only its recorder may)"),
    patch: z.record(z.string(), z.unknown()).optional().describe("New values for the item's own fields (only its recorder may)"),
  })
  .describe("Exactly one of the four")
  .meta({ id: "ItemPatch" });

// A list of components is a component too: the generator only resolves a $ref at the top of a schema.
export const PersonListJson = z.array(PersonJson).meta({ id: "PersonList" });
export const DueListJson = z.array(DueItemJson).meta({ id: "DueList" });

export const COMPONENTS = [ErrorJson, PersonJson, PersonListJson, BriefingJson, DueItemJson, DueListJson, IntervalJson, MergeJson, NewConversationJson, RecordedJson, ConversationJson, ItemPatchJson];

export const IdParam = z.string().describe("The id");
export const TableParam = z.string().describe("The kind of item: `facts`, `promises`, `dates`, `exchanges`, `relationships` or `conversations`");
export const PeopleQuery = z.object({ q: z.string().optional().describe("A name or alias to search for; best matches first, at most 5. Without it, every person") });
