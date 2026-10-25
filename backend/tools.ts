// The tools Claude gets, in one table: the MCP endpoint (mcp.ts) offers them to a connected client, and the in-app chat
// (chat.ts) to its own Claude. Each runs as the viewer it is given, over the same domain functions the REST API uses, so
// privacy is decided in the domain, never by Claude. Results carry paths; mcp.ts makes them absolute for its clients.
import * as z from "zod";
import { briefing } from "./briefing";
import { getConversation, recordConversation, remember } from "./conversations";
import { deleteItem, editItem, ITEM_TABLES, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript } from "./corrections";
import { whatsDue } from "./due";
import { addGroupAlias, deleteGroup, listGroups, mergeGroups, removeFromGroup, removeGroupAlias, renameGroup } from "./groups";
import { InvalidInputError } from "./errors";
import {
  BriefingJson,
  Day,
  DueItemJson,
  GroupJson,
  IntervalJson,
  NewConversationJson,
  PersonId,
  PersonJson,
  RecordedJson,
  Visibility,
} from "./http/schemas";
import { setCheckInInterval } from "./intervals";
import { addAlias, findPeople } from "./people";
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
  id: z.string().optional().describe("The new relationship's id, or the group's"),
  added: z.number().int().optional().describe("How many group memberships were new; one the user already recorded is kept as it was"),
  url: z.string().optional().describe("For a relationship: the page of `from`, which shows it; for a group: the group's page. An absolute URL"),
  name: z.string().optional().describe("group: the group's own name; the name given may have been another name of it"),
});
const GroupsJson = z.object({
  groups: z.array(GroupJson.extend({})).describe("By name"),
});
const SetIntervalJson = IntervalJson.extend({
  personId: PersonId,
  url: z.string().describe("The person's page, as an absolute URL"),
});
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
] as const;
const CorrectInput = z.object({
  action: z
    .enum(CORRECT_ACTIONS)
    .describe(
      "done: mark a promise done or an exchange settled (table, id). outdated: mark a fact no longer true (id). edit: change fields of an item the user recorded (table, id, patch). visibility: change who can see an item the user recorded (table, id, visibility). delete: delete an item the user recorded, a conversation with its items (table, id). rename: rename a person (id, name). alias: add another name a person goes by (id, alias). merge: merge the duplicate drop into the person id (id, drop). share_transcript: let the partner read the transcript of a conversation the user recorded, once nothing in it is private any more (id); a transcript never turns shared on its own. ungroup: take a person out of a group (id = the group's, person). group_rename: rename a group; its old name keeps finding it (id, name). group_alias / group_unalias: add or drop another name of a group, e.g. Kollegen for Arbeit (id, alias). group_merge: merge the group drop into the group id (id, drop). group_delete: delete a group for the user (id)",
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
]);

const PrivateItem = z.boolean().optional().describe("Makes just this item private");
const RememberInput = z.object({
  visibility: Visibility,
  facts: z.array(z.object({ person: PersonId, text: z.string(), category: z.enum(FACT_CATEGORIES), private: PrivateItem })).optional(),
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
      'File a conversation the user told you about, with the verbatim ramble as transcript, a short summary, who was involved and what was learned; use it after every ramble about meeting, calling or messaging someone. First resolve every person with find_person, ask the user when a name fits more than one person or resembles an existing one, and set confirmedNew on a new person only once the user said they are someone else. date is today unless the user says otherwise: when the user says when it happened ("the day before yesterday"), pass that day. If anything is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling, and keep it out of the summary.',
    input: NewConversation,
    output: Recorded,
    annotations: { destructiveHint: false },
    handler: async (v, c) => ok(Recorded, await recordConversation(v, c)),
  }),
  tool({
    name: "remember",
    description:
      "File what the user tells you about people the book already has when it isn't a conversation: a birthday or another date, a fact, a promise, a gift idea or another exchange (\"Malou's birthday is 7 February 2024\", \"Anna's new job is at the museum\"). Resolve every person with find_person first; for someone not in the book yet, or when the user is telling about a meeting, call or message, use record_conversation instead. If anything is sensitive, ask the user whether it should be private before calling.",
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
      "Everything worth knowing about a person: when the user last saw them, recent conversations, current facts, open promises and exchanges, gift ideas, upcoming dates and relationships. A fact read from a social media screenshot the user shared carries its `source` (Instagram, LinkedIn, ...) and `happenedOn`: say where and when you know it from. Use it before the user meets someone, or when they ask about a person.",
    input: z.object({ personId: PersonId }),
    output: BriefingOut,
    annotations: { readOnlyHint: true },
    handler: async (v, { personId }) => ok(BriefingOut, await briefing(v, personId)),
  }),
  tool({
    name: "whats_due",
    description:
      'What needs attention soon: upcoming birthdays and other dates, promises with a due date, and people the user is overdue to see. Use it for questions like "who should I call this weekend?".',
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
      "Record how two people are related, or put people in a group, when the user mentions it outside of a conversation to file; pass person ids from find_person. If it is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling.",
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
              })),
              url: personPath(a.from),
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
    name: "correct",
    description:
      "Fix something already filed: mark a promise done or an exchange settled, mark a fact outdated, edit or delete an item, change who can see it, rename a person or add an alias, merge a duplicate or let the partner read a transcript. Use it when the user says something is done, no longer true or wrong. If the conversation was on another day: edit, table conversations, patch { date }.",
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
