// The tools Claude gets, in one table: the MCP endpoint (mcp.ts) offers them to a connected client, and the in-app chat
// (chat.ts) to its own Claude. Each runs as the viewer it is given, over the same domain functions the REST API uses, so
// privacy is decided in the domain, never by Claude. Results carry paths; mcp.ts makes them absolute for its clients.
import * as z from "zod";
import { briefing } from "./briefing";
import { createCalendarKey, feedPath, hasCalendarKey, revokeCalendarKey } from "./calendar";
import { getConversation, recordConversation, remember } from "./conversations";
import { deleteItem, editItem, factToRelationship, ITEM_TABLES, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript } from "./corrections";
import { whatsDue } from "./due";
import { addGroupAlias, deleteGroup, listGroups, mergeGroups, removeFromGroup, removeGroupAlias, renameGroup } from "./groups";
import { InvalidInputError } from "./errors";
import {
  BriefingJson,
  CalendarFeedJson,
  CheckAfter,
  Day,
  DueItemJson,
  FactKind,
  Gender,
  GroupJson,
  IntervalJson,
  NewConversationJson,
  PersonId,
  PersonJson,
  RecordedJson,
  HOUSEHOLD_TARGET,
  Visibility,
} from "./http/schemas";
import { isHouseholdWord } from "./household";
import { setCheckInInterval } from "./intervals";
import { addAlias, findPeople, setGender } from "./people";
import { addRelationship, addToGroup } from "./relationships";
import { EXCHANGE_KINDS, FACT_CATEGORIES, RELATIONSHIP_TYPES, type Viewer } from "./types";
import { conversationPath, personPath } from "./urls";

export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  output: z.ZodObject;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  /** Checks `args` against `input` (a mismatch is an InvalidInputError, a refusal the caller reports), runs as `v`, and returns
   * the result as `output` declares it: fields the schema doesn't name are dropped. */
  run(v: Viewer, args: unknown): Promise<Record<string, unknown>>;
};

// A handler's result, typed by its output schema; `tool` parses it.
const ok = <S extends z.ZodType>(_schema: S, body: z.input<S>) => body;

function tool<I extends z.ZodObject, O extends z.ZodObject>(t: {
  name: string;
  description: string;
  input: I;
  output: O;
  annotations: Tool["annotations"];
  handler: (v: Viewer, args: z.output<I>) => Promise<z.input<O>>;
}): Tool {
  return {
    name: t.name,
    description: t.description,
    input: t.input,
    output: t.output,
    annotations: t.annotations,
    async run(v, args) {
      return t.output.parse(await t.handler(v, check(t.input, args))) as Record<string, unknown>;
    },
  };
}

// A named API schema (.meta({ id })) converts to a bare $ref, and a tool's schema must be an object at its root; a copy
// made by extend() carries no id, so it converts inline.
const NewConversation = NewConversationJson.extend({});
const Recorded = RecordedJson.extend({});
const BriefingOut = BriefingJson.extend({});
const CalendarFeed = CalendarFeedJson.extend({});

const GroupId = z.string().describe("A group's id, as groups or relate return it");
const ConversationId = z.string().describe("A conversation's id, as a briefing's recent conversations or record_conversation return it");
const Table = z.enum(ITEM_TABLES).describe("The kind of item");
const ItemId = z.string().describe("The item's id, as a briefing shows it");

const FoundJson = z.object({
  people: z.array(PersonJson).describe("Best matches first, at most 5"),
});
const DueJson = z.object({
  items: z.array(DueItemJson).describe("Most pressing first"),
});
const RelatedJson = z.object({
  id: z.string().optional().describe("The relationship's id (the first, for \"us\"), or the group's"),
  ids: z.array(z.string()).optional().describe("relationship: one per pair it stands for; \"us\" is one per household person. An existing one's id when it was already there"),
  added: z.number().int().optional().describe("How many group memberships were new; one the user already recorded is kept as it was"),
  url: z.string().optional().describe("For a relationship: the page of `from` (of `to` when from is \"me\" or \"us\"), which shows it; for a group: the group's page. An absolute URL"),
  name: z.string().optional().describe("group: the group's own name; the name given may have been another name of it"),
});
const GroupsJson = z.object({
  groups: z.array(GroupJson.extend({})).describe("By name"),
});
const SetIntervalJson = IntervalJson.extend({
  personId: PersonId,
  url: z.string().describe("The person's page, as an absolute URL"),
});
const CALENDAR_ACTIONS = ["show", "replace", "revoke"] as const;
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
function check<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidInputError(r.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; "));
  return r.data;
}

const RELATE_KINDS = ["relationship", "group"] as const;
const Target = z.union([PersonId, HOUSEHOLD_TARGET]);
const TYPE_DOC =
  "`from` is `type` of `to`: with `parent`, from is the parent of to; with `landlord` or `doctor`, from is the landlord or doctor of to; with `service`, from works for to (the note says what, e.g. Klempner). neighbour, colleague, friend, sibling, partner and spouse read both ways";
const RelateInput = z.object({
  kind: z.enum(RELATE_KINDS).describe("`relationship` takes from, to, type and an optional note; `group` takes name and members"),
  from: Target.optional().describe('relationship: the person who is `type` of `to`, or "me" / "us"'),
  to: Target.optional().describe('relationship: the other person, or "me" / "us" for a role to the household'),
  type: z.enum(RELATIONSHIP_TYPES).optional().describe(`relationship: ${TYPE_DOC}`),
  note: z.string().optional().describe("relationship: an optional note"),
  name: z.string().optional().describe("group: the group's name, e.g. Uni or Climbing"),
  members: z.array(PersonId).optional().describe("group: the ids of the people to add, at least one"),
  visibility: Visibility,
});

const RelateArgs = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relationship"),
    from: Target,
    to: Target,
    type: z.enum(RELATIONSHIP_TYPES).describe(TYPE_DOC),
    note: z.string().optional(),
    visibility: Visibility,
  }),
  z.object({
    kind: z.literal("group"),
    name: z.string().describe("The group's name, e.g. Uni or Climbing"),
    members: z.array(PersonId).min(1),
    visibility: Visibility,
  }),
]);

const CORRECT_ACTIONS = [
  "done",
  "outdated",
  "edit",
  "visibility",
  "delete",
  "rename",
  "alias",
  "merge",
  "share_transcript",
  "ungroup",
  "group_rename",
  "group_alias",
  "group_unalias",
  "group_merge",
  "group_delete",
  "gender",
  "to_relationship",
] as const;
const CorrectInput = z.object({
  action: z
    .enum(CORRECT_ACTIONS)
    .describe(
      "done: mark a promise done or an exchange settled (table, id). outdated: mark a fact no longer true (id). edit: change fields of an item the user recorded (table, id, patch). visibility: change who can see an item the user recorded (table, id, visibility). delete: delete an item the user recorded, a conversation with its items (table, id). rename: rename a person (id, name). alias: add another name a person goes by (id, alias). merge: merge the duplicate drop into the person id (id, drop). share_transcript: let the partner read the transcript of a conversation the user recorded, once nothing in it is private any more (id); a transcript never turns shared on its own. ungroup: take a person out of a group (id = the group's, person). group_rename: rename a group; its old name keeps finding it (id, name). group_alias / group_unalias: add or drop another name of a group, e.g. Kollegen for Arbeit (id, alias). group_merge: merge the group drop into the group id (id, drop). group_delete: delete a group for the user (id). gender: set or (null) clear a person's gender (id, gender), only when the user states it or uses a pronoun for the person, never from the name. to_relationship: turn a fact into a relationship, which keeps its visibility, and delete the fact (id = the fact's, from, to, type, note), e.g. the fact \"our landlady\" into landlord from her to \"us\"",
    ),
  table: Table.optional().describe("done, edit, visibility, delete: the kind of item (done: promises or exchanges)"),
  id: z
    .string()
    .describe(
      "The item's id as a briefing shows it; for rename, alias and merge, a person's id (merge: the person to keep); for share_transcript, a conversation's id; for the group actions, the group's id (group_merge: the group to keep)",
    ),
  person: PersonId.optional().describe("ungroup: the person to take out"),
  patch: z.record(z.string(), z.unknown()).optional().describe("edit: new values for the item's own fields"),
  visibility: Visibility.optional().describe("visibility: who may see the item from now on"),
  name: z.string().optional().describe("rename: the person's new name"),
  alias: z.string().optional().describe("alias: another name the person goes by, e.g. a nickname"),
  drop: z.string().optional().describe("merge: the duplicate person; group_merge: the group to merge in. It is deleted"),
  gender: Gender.nullable().optional().describe("gender: the person's gender; null when it isn't known"),
  from: Target.optional().describe('to_relationship: who is `type` of `to`; a person id, "me" or "us"'),
  to: Target.optional().describe('to_relationship: the other end; a person id, "me" or "us"'),
  type: z.enum(RELATIONSHIP_TYPES).optional().describe(`to_relationship: ${TYPE_DOC}`),
  note: z.string().optional().describe("to_relationship: an optional note"),
});

const CorrectArgs = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("done"),
      table: z.enum(["promises", "exchanges"]),
      id: ItemId,
    })
    .describe("Mark a promise done or an exchange settled"),
  z
    .object({
      action: z.literal("outdated"),
      id: ItemId.describe("The fact's id"),
    })
    .describe("Mark a fact no longer true"),
  z
    .object({
      action: z.literal("edit"),
      table: Table,
      id: ItemId,
      patch: z.record(z.string(), z.unknown()).describe("New values for the item's own fields"),
    })
    .describe("Change fields of an item the user recorded"),
  z
    .object({
      action: z.literal("visibility"),
      table: Table,
      id: ItemId,
      visibility: Visibility,
    })
    .describe("Change who can see an item the user recorded"),
  z
    .object({ action: z.literal("delete"), table: Table, id: ItemId })
    .describe("Delete an item the user recorded; a conversation takes its items with it"),
  z.object({ action: z.literal("rename"), id: PersonId, name: z.string() }).describe("Rename a person"),
  z.object({ action: z.literal("alias"), id: PersonId, alias: z.string() }).describe("Add another name a person goes by"),
  z
    .object({
      action: z.literal("merge"),
      id: PersonId.describe("The person to keep"),
      drop: PersonId.describe("The duplicate; it is deleted"),
    })
    .describe("Merge a duplicate person"),
  z.object({ action: z.literal("share_transcript"), id: ConversationId }).describe("Let the partner read a conversation's transcript"),
  z.object({ action: z.literal("ungroup"), id: GroupId, person: PersonId }).describe("Take a person out of a group"),
  z
    .object({
      action: z.literal("group_rename"),
      id: GroupId,
      name: z.string(),
    })
    .describe("Rename a group"),
  z
    .object({
      action: z.literal("group_alias"),
      id: GroupId,
      alias: z.string(),
    })
    .describe("Add another name of a group"),
  z
    .object({
      action: z.literal("group_unalias"),
      id: GroupId,
      alias: z.string(),
    })
    .describe("Drop another name of a group"),
  z
    .object({
      action: z.literal("group_merge"),
      id: GroupId.describe("The group to keep"),
      drop: GroupId.describe("The group to merge in; it is deleted"),
    })
    .describe("Merge two groups"),
  z.object({ action: z.literal("group_delete"), id: GroupId }).describe("Delete a group for the user"),
  z.object({ action: z.literal("gender"), id: PersonId, gender: Gender.nullable() }).describe("Set or clear a person's gender"),
  z
    .object({ action: z.literal("to_relationship"), id: ItemId.describe("The fact's id"), from: Target, to: Target, type: z.enum(RELATIONSHIP_TYPES), note: z.string().optional() })
    .describe("Turn a fact into a relationship"),
]);

const PrivateItem = z.boolean().optional().describe("Makes just this item private");
const RememberInput = z.object({
  visibility: Visibility,
  facts: z
    .array(
      z.object({
        person: PersonId,
        text: z.string(),
        category: z.enum(FACT_CATEGORIES),
        private: PrivateItem,
        supersedes: z.string().optional().describe("The id of the fact this replaces: news about a situation, or a lasting fact that ends it"),
        kind: FactKind.optional(),
        checkAfter: CheckAfter.optional(),
      }),
    )
    .optional(),
  promises: z.array(z.object({ person: PersonId, text: z.string(), byMe: z.boolean().describe("Whether the user made the promise"), due: Day.optional(), private: PrivateItem })).optional(),
  dates: z
    .array(
      z.object({
        person: PersonId,
        kind: z.enum(["birthday", "anniversary", "custom"]),
        date: z.string().describe("`YYYY-MM-DD`, or `--MM-DD` for a yearly date without a year"),
        label: z.string().optional(),
        yearly: z.boolean(),
        private: PrivateItem,
      }),
    )
    .optional(),
  exchanges: z
    .array(
      z.object({
        person: PersonId,
        kind: z.enum(EXCHANGE_KINDS),
        direction: z.enum(["to_them", "from_them"]).describe("`to_them`: the user gave; `from_them`: the person gave"),
        text: z.string(),
        amount: z.number().optional(),
        currency: z.string().optional(),
        private: PrivateItem,
      }),
    )
    .optional(),
});
const RememberedJson = z.object({
  counts: z.object({ facts: z.number().int(), promises: z.number().int(), dates: z.number().int(), exchanges: z.number().int() }),
  people: z.array(z.object({ id: PersonId, name: z.string(), url: z.string() })).describe("The people it is about, with a link to each"),
});

export const TOOLS: readonly Tool[] = [
  tool({
    name: "record_conversation",
    description:
      'File a conversation the user told you about, with the verbatim ramble as transcript, a short summary, who was involved and what was learned; use it after every ramble about meeting, calling or messaging someone. First resolve every person with find_person, ask the user when a name fits more than one person or resembles an existing one, and set confirmedNew on a new person only once the user said they are someone else. date is today unless the user says otherwise: when the user says when it happened ("the day before yesterday"), pass that day. If anything is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling, and keep it out of the summary. Who someone is to the household (landlord, neighbour, doctor, service, colleague: "she\'s our landlady") is a relationship to "us" (both of the household) or "me", never a fact; "we rent from her" is landlord from her to "us". Facts: kind `situation` for what is going on and will end (moving, a new dog, looking for a car), with checkAfter estimated from how long it usually takes (a car: a few weeks, a house: months); everything else is `lasting`. News about a situation supersedes it (supersedes, which resets checkAfter); when the user tells how it ended, mark it outdated with correct and file the outcome as a lasting fact if it is worth keeping. Set a person\'s gender only when the user states it or uses a pronoun for them ("she is our landlady"), never from the name.',
    input: NewConversation,
    output: Recorded,
    annotations: { destructiveHint: false },
    handler: async (v, c) => ok(Recorded, await recordConversation(v, c)),
  }),
  tool({
    name: "remember",
    description:
      "File what the user tells you about people the book already has when it isn't a conversation: a birthday or another date, a fact, a promise, a gift idea or another exchange (\"Malou's birthday is 7 February 2024\", \"Anna's new job is at the museum\"). Resolve every person with find_person first; for someone not in the book yet, or when the user is telling about a meeting, call or message, use record_conversation instead. If anything is sensitive, ask the user whether it should be private before calling. Facts: kind `situation` for what is going on and will end (moving, a new dog, looking for a car), with checkAfter estimated from how long it usually takes (a car: a few weeks, a house: months); everything else is `lasting`. News about a situation supersedes it (supersedes, which resets checkAfter); when the user tells how it ended, mark it outdated with correct and file the outcome as a lasting fact if it is worth keeping. A role (\"our landlady\") is not a fact: file it with relate.",
    input: RememberInput,
    output: RememberedJson,
    annotations: { destructiveHint: false },
    handler: async (v, r) => ok(RememberedJson, await remember(v, r)),
  }),
  tool({
    name: "find_person",
    description:
      "Find people by name or alias, tolerant of spelling, each with context that tells people of the same name apart; always call this before referring to a person by id. When more than one candidate fits, ask the user which one.",
    input: z.object({
      name: z.string().describe("A name or alias, as the user said it"),
    }),
    output: FoundJson,
    annotations: { readOnlyHint: true },
    handler: async (v, { name }) => ok(FoundJson, { people: await findPeople(v, name) }),
  }),
  tool({
    name: "briefing",
    description:
      "Everything worth knowing about a person: who they are to the household (`roles`, read from the user's side: `us`, `me`, or `partner` with the partner's name; answer \"how do I know X?\" from `roles` first, e.g. \"she's your landlady\"), what is going on (`situations`; ask about the ones with `nudge` first), what stays true (`known`), the one-hop `network`, when the user last saw them, recent conversations, open promises and exchanges, gift ideas, upcoming dates and relationships. A fact read from a social media screenshot the user shared carries its `source` (Instagram, LinkedIn, ...) and `happenedOn`: say where and when you know it from. Each relationship has its id and note, so a wrong or doubled one can be fixed with correct (table `relationships`). Use it before the user meets someone, or when they ask about a person.",
    input: z.object({ personId: PersonId }),
    output: BriefingOut,
    annotations: { readOnlyHint: true },
    handler: async (v, { personId }) => ok(BriefingOut, await briefing(v, personId)),
  }),
  tool({
    name: "whats_due",
    description:
      'What needs attention soon: upcoming birthdays and other dates, promises with a due date, people the user is overdue to see, and situations to ask about (kind `situation`: "ask Jonas whether he found a car"). Use it for questions like "who should I call this weekend?".',
    input: z.object({
      from: Day.optional().describe("The day to look from; today when left out"),
      horizonDays: z.number().int().min(1).max(366).optional().describe("How many days ahead to look; 14 when left out"),
    }),
    output: DueJson,
    annotations: { readOnlyHint: true },
    handler: async (v, { from, horizonDays }) => ok(DueJson, { items: await whatsDue(v, from, horizonDays) }),
  }),
  tool({
    name: "relate",
    description:
      "Record how two people are related, or put people in a group, when the user mentions it outside of a conversation to file; pass person ids from find_person. If it is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling. Who someone is to the household (landlord, neighbour, doctor, service, colleague: \"she's our landlady\") is a relationship to \"us\" (both of the household) or \"me\", never a fact; \"we rent from her\" is landlord from her to \"us\". Filing the same relationship again, either way round, keeps the one there.",
    input: RelateInput,
    output: RelatedJson,
    annotations: { destructiveHint: false },
    handler: async (v, input) => {
      const a = check(RelateArgs, input);
      return ok(
        RelatedJson,
        a.kind === "relationship"
          ? {
              ...(await addRelationship(v, {
                from: a.from,
                to: a.to,
                type: a.type,
                note: a.note,
                visibility: a.visibility,
              }).then(({ ids }) => ({ id: ids[0], ids }))),
              url: personPath(isHouseholdWord(a.from) ? a.to : a.from),
            }
          : await addToGroup(v, {
              name: a.name,
              members: a.members,
              visibility: a.visibility,
            }),
      );
    },
  }),
  tool({
    name: "set_interval",
    description:
      "Save how often the user wants to see a person, in days; null means no check-ins. Use it once the user agrees to a suggested interval or names one themselves.",
    input: z.object({
      personId: PersonId,
      days: z.number().int().nullable().describe("Days between check-ins, 1 to 3650; null for none"),
      confirmed: z.boolean().default(true).describe("Whether the user agreed to it; false only for an interval you set without asking"),
    }),
    output: SetIntervalJson,
    annotations: { destructiveHint: false, idempotentHint: true },
    handler: async (v, { personId, days, confirmed }) => {
      await setCheckInInterval(v, personId, days, confirmed);
      return ok(SetIntervalJson, {
        personId,
        days,
        confirmed,
        url: personPath(personId),
      });
    },
  }),
  tool({
    name: "calendar_feed",
    description:
      "The user's calendar feed: a secret ICS URL with every birthday (yearly, with the age when the year is known), the other dates and their own promises with a due date, to subscribe to in Google Calendar (\"From URL\") or any calendar app. `show` makes one when the user has none; when they already have one it can't be shown again (only its hash is kept), so tell them and offer `replace`. `replace` makes a new URL and `revoke` turns the feed off; both stop the old URL at once, so calendars subscribed to it go empty: ask the user before either. The URL lets anyone who has it read these dates, so give it only to the user. Google Calendar refreshes a subscribed feed only every few hours.",
    input: z.object({
      action: z.enum(CALENDAR_ACTIONS).default("show").describe("`show` (default) makes a feed when there is none; `replace` makes a new URL; `revoke` turns it off"),
    }),
    output: CalendarFeed,
    annotations: { destructiveHint: true },
    handler: async (v, { action }) => {
      if (action === "revoke") {
        await revokeCalendarKey(v);
        return ok(CalendarFeed, { active: false, created: false, url: null });
      }
      if (action === "show" && (await hasCalendarKey(v))) return ok(CalendarFeed, { active: true, created: false, url: null });
      return ok(CalendarFeed, { active: true, created: true, url: feedPath(await createCalendarKey(v)) });
    },
  }),
  tool({
    name: "correct",
    description:
      "Fix something already filed: mark a promise done or an exchange settled, mark a fact outdated, edit or delete an item, change who can see it, rename a person or add an alias, set a person's gender (only when the user states it or uses a pronoun for them, never from the name), turn a fact into a relationship, merge a duplicate or let the partner read a transcript. A fact moves between lasting and situation with edit, patch { kind, checkAfter }. Use it when the user says something is done, no longer true or wrong. If the conversation was on another day: edit, table conversations, patch { date }.",
    input: CorrectInput,
    output: CorrectedJson,
    annotations: { destructiveHint: true },
    handler: async (v, input) => {
      const a = check(CorrectArgs, input);
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
        case "ungroup":
          await removeFromGroup(v, a.id, a.person);
          break;
        case "group_rename":
          await renameGroup(v, a.id, a.name);
          break;
        case "group_alias":
          await addGroupAlias(v, a.id, a.alias);
          break;
        case "group_unalias":
          await removeGroupAlias(v, a.id, a.alias);
          break;
        case "group_merge":
          await mergeGroups(v, a.id, a.drop);
          break;
        case "group_delete":
          await deleteGroup(v, a.id);
          break;
        case "gender":
          await setGender(v, a.id, a.gender);
          break;
        case "to_relationship":
          await factToRelationship(v, a.id, { from: a.from, to: a.to, type: a.type, note: a.note });
          break;
      }
      return ok(CorrectedJson, { corrected: true as const });
    },
  }),
  tool({
    name: "groups",
    description:
      "Every group the user sees, with its other names and how many people are in it. Call it before putting someone in a group, and reuse a group whose name or other name fits.",
    input: z.object({}),
    output: GroupsJson,
    annotations: { readOnlyHint: true },
    handler: async (v) => ok(GroupsJson, { groups: await listGroups(v) }),
  }),
  tool({
    name: "get_transcript",
    description:
      "The verbatim ramble a conversation was recorded from. Use it when the user asks what exactly was said, or a briefing's summary isn't enough.",
    input: z.object({ conversationId: ConversationId }),
    output: TranscriptJson,
    annotations: { readOnlyHint: true },
    handler: async (v, { conversationId }) => {
      const c = await getConversation(v, conversationId);
      return ok(TranscriptJson, {
        conversationId: c.id,
        url: conversationPath(c.id),
        date: c.date,
        transcript: c.transcript,
      });
    },
  }),
];

export const toolByName = (name: string): Tool | undefined => TOOLS.find((t) => t.name === name);
