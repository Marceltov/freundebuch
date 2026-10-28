// The tools Claude gets, in one table: the MCP endpoint (mcp.ts) offers them to a connected client, and the in-app chat
// (chat.ts) to its own Claude. Each runs as the viewer it is given, over the same domain functions the REST API uses, so
// privacy is decided in the domain, never by Claude. Results carry paths; mcp.ts makes them absolute for its clients.
// Every result also carries `next`: what Claude should do now, worked out here from what the domain returned (docs/adr/0010). It
// is built only from those results, which the domain read through visible(), so it can't name what the viewer may not see.
import * as z from "zod";
import { briefing, type Briefing } from "./briefing";
import { createCalendarKey, feedPath, hasCalendarKey, revokeCalendarKey } from "./calendar";
import { getConversation, recordConversation, remember, type FiledFact, type FiledRelationship } from "./conversations";
import { deleteItem, editItem, factToRelationship, ITEM_TABLES, markDone, markOutdated, mergePeople, renamePerson, setVisibility, shareTranscript, type Moved } from "./corrections";
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
  FiledItemsJson,
  FiledRelationshipJson,
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
import { addAlias, findPeople, setGender, type Candidate, type Relabel } from "./people";
import { addRelationship, addToGroup } from "./relationships";
import { EXCHANGE_KINDS, FACT_CATEGORIES, isTrait, type TraitKind, type Viewer } from "./types";
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
   * the result as `output` declares it, `next` included: fields the schema doesn't name are dropped. */
  run(v: Viewer, args: unknown): Promise<Record<string, unknown>>;
};

const Next = z
  .array(z.string())
  .describe("What to do now, worked out from what this call did: follow it before you answer the user. Empty when there is nothing to do");
type Next = string[];

// A handler's result, typed by its output schema, with its `next`; `tool` parses it.
const ok = <S extends z.ZodType>(_schema: S, body: z.input<S>, next: Next = []) => ({ ...(body as object), next }) as z.input<S> & { next: Next };

function tool<I extends z.ZodObject, O extends z.ZodObject>(t: {
  name: string;
  description: string;
  input: I;
  output: O;
  annotations: Tool["annotations"];
  handler: (v: Viewer, args: z.output<I>) => Promise<z.input<O> & { next: Next }>;
}): Tool {
  const output = t.output.extend({ next: Next });
  return {
    name: t.name,
    description: t.description,
    input: t.input,
    output,
    annotations: t.annotations,
    async run(v, args) {
      return output.parse(await t.handler(v, check(t.input, args))) as Record<string, unknown>;
    },
  };
}

// The lines of `next`. Each is one short instruction in English, about what this call did.

const TRAIT_WORDS: Record<TraitKind, string> = { need: "a need: something to plan around", personality: "personality: how the person is" };
const nowTrait = (name: string, text: string, kind: TraitKind): Next => [`"${text}" now shows under ${name}'s traits, as ${TRAIT_WORDS[kind]}.`];

const situationDay = (f: Pick<FiledFact, "name" | "text" | "kind" | "checkAfter" | "defaultCheckAfter">): Next =>
  f.kind !== "situation" || !f.checkAfter
    ? []
    : [
        f.defaultCheckAfter
          ? `${f.name}'s situation "${f.text}" nudges on ${f.checkAfter}, a default because you gave no checkAfter: tell the user, and change it with correct (edit, table facts, patch { checkAfter }) if they want another day.`
          : `${f.name}'s situation "${f.text}" nudges on ${f.checkAfter}: tell the user that day.`,
      ];

const keptRelationship = (r: FiledRelationship): Next =>
  r.created ? [] : [`${r.fromName} is already ${r.label} of ${r.toName} (relationship ${r.id}): it was kept as it was, nothing new was filed.`];

const alreadyInGroup = (g: { name: string; already: number }): Next =>
  g.already ? [`${g.already} of them ${g.already === 1 ? "was" : "were"} in ${g.name} already; nothing changed for them.`] : [];

const MOVED_WORDS: Record<keyof Moved, [string, string]> = {
  facts: ["fact", "facts"],
  promises: ["promise", "promises"],
  dates: ["date", "dates"],
  exchanges: ["exchange", "exchanges"],
  relationships: ["relationship", "relationships"],
  conversations: ["conversation", "conversations"],
  groups: ["group membership", "group memberships"],
};

function merged(m: { kept: string; dropped: string; moved: Moved }): Next {
  const parts = (Object.keys(MOVED_WORDS) as (keyof Moved)[]).filter((k) => m.moved[k]).map((k) => `${m.moved[k]} ${MOVED_WORDS[k][m.moved[k] === 1 ? 0 : 1]}`);
  const what = parts.length ? `${parts.join(", ")} moved` : "nothing else moved";
  return [`Merged ${m.dropped} into ${m.kept}: ${what}, and "${m.dropped}" now finds ${m.kept}. Look over ${m.kept}'s briefing for anything doubled and fix it with correct.`];
}

const PRONOUN: Record<string, string> = { female: "her", male: "his", nonbinary: "their" };

function relabel(personId: string, gender: string | null, rels: Relabel[]): Next {
  return rels.map((r) => {
    const mine = r.fromId === personId;
    const name = mine ? r.fromName : r.toName;
    const form = gender ? `in ${PRONOUN[gender]} new gender` : "in its ':in' form, now that the gender isn't known";
    return `Put ${name}'s word in "${r.fromName} is ${r.label} of ${r.toName}" ${form}: correct (edit, table relationships, id ${r.id}, patch { ${mine ? "label" : "inverse"} }).`;
  });
}

const WITH: Record<string, (partner?: string) => string> = { us: () => "you both", me: () => "you", partner: (p) => p ?? "your partner" };

function briefingNext(b: Briefing): Next {
  const next: Next = [];
  if (b.roles.length) next.push(`Lead with who ${b.person.name} is to the household: ${b.roles.map((r) => `${r.label} of ${WITH[r.with](r.partnerName)}`).join("; ")}.`);
  for (const f of b.situations.filter((x) => x.nudge))
    next.push(
      `Ask about "${f.text}" first: its day to ask, ${f.checkAfter}, has come. When the user tells how it went, mark it outdated with correct; news instead supersedes it, with a new checkAfter agreed with the user.`,
    );
  if ([...b.situations, ...b.known].some((f) => f.source)) next.push("Some facts were read from screenshots the user shared: say where (source) and when (happenedOn) you know them from.");
  if (b.suggestedInterval !== undefined)
    next.push(`Offer to check in with ${b.person.name} every ${b.suggestedInterval} days; save it with set_interval once the user agrees.`);
  return next;
}

function foundNext(name: string, people: Candidate[]): Next {
  if (!people.length) return [`No one in the book is called "${name}". Ask the user whether this is someone new; if so, file them as a new person with record_conversation.`];
  if (people.length === 1) return [];
  const list = people.map((p) => `${p.name} (id ${p.id}${p.context.length ? `; ${p.context.join(", ")}` : ""})`).join(", ");
  return [`${people.length} people match "${name}": ${list}. Ask the user which one they mean; never guess.`];
}

// A named API schema (.meta({ id })) converts to a bare $ref, and a tool's schema must be an object at its root; a copy
// made by extend() carries no id, so it converts inline.
const NewConversation = NewConversationJson.extend({});
const Recorded = RecordedJson.extend({});
const Filed = FiledItemsJson.extend({});
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
  relationships: z.array(FiledRelationshipJson).optional().describe("relationship: each pair, and whether it was new"),
  added: z.number().int().optional().describe("How many group memberships were new; one the user already recorded is kept as it was"),
  already: z.number().int().optional().describe("group: how many of the members the user had put in it before"),
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
const Relabels = z.array(
  z.object({
    id: z.string(),
    fromId: PersonId,
    fromName: z.string(),
    toId: PersonId,
    toName: z.string(),
    label: z.string().describe("What from is to to"),
    inverse: z.string().describe("What to is to from"),
  }),
);
const CorrectedJson = z.object({
  corrected: z.literal(true),
  fact: z
    .object({
      id: z.string(),
      personId: PersonId,
      name: z.string(),
      text: z.string(),
      kind: FactKind,
      checkAfter: Day.nullable(),
      defaultCheckAfter: z.boolean().optional().describe("edit: the server chose checkAfter, six weeks from now, as the fact just became a situation"),
      status: z.enum(["current", "outdated"]),
    })
    .optional()
    .describe("outdated, and edit of a fact: the fact as it now stands"),
  moved: z
    .object({ facts: z.number().int(), promises: z.number().int(), dates: z.number().int(), exchanges: z.number().int(), relationships: z.number().int(), conversations: z.number().int(), groups: z.number().int() })
    .optional()
    .describe("merge: what moved over to the person kept, as the user may see it"),
  relationships: z.array(FiledRelationshipJson).optional().describe("to_relationship: each pair, and whether it was new"),
  relabel: Relabels.optional().describe("gender: the person's relationships the user may edit (their own and the partner's shared ones), whose words are written in each end's gender"),
});
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
const WORDS_DOC =
  "There is no fixed list of types: say in German words what each end is, in that person's gender (the ':in' form when it isn't known): label what `from` is to `to`, inverse what `to` is to `from`. \"She is our landlady\": from her, to \"us\", label Vermieterin, inverse Mieter:in; Tom's mother Anna: from Anna, to Tom, label Mutter, inverse Sohn; Lena and Tom next door: label Nachbarin, inverse Nachbar. Use the usual word, so the same relationship is found again; ask the user only when you can't tell who is what";
const RelateInput = z.object({
  kind: z.enum(RELATE_KINDS).describe("`relationship` takes from, to, label, inverse and an optional note; `group` takes name and members"),
  from: Target.optional().describe('relationship: a person, or "me" / "us"'),
  to: Target.optional().describe('relationship: the other person, or "me" / "us" for a role to the household'),
  label: z.string().optional().describe(`relationship: what \`from\` is to \`to\`. ${WORDS_DOC}`),
  inverse: z.string().optional().describe("relationship: what `to` is to `from`"),
  note: z.string().optional().describe("relationship: anything more about it (\"seit der Schulzeit\")"),
  name: z.string().optional().describe("group: the group's name, e.g. Uni or Climbing"),
  members: z.array(PersonId).optional().describe("group: the ids of the people to add, at least one"),
  visibility: Visibility,
});

const RelateArgs = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relationship"),
    from: Target,
    to: Target,
    label: z.string(),
    inverse: z.string(),
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
      "done: mark a promise done or an exchange settled (table, id). outdated: mark a fact no longer true (id). edit: change fields of an item the user recorded, or of a shared one the partner recorded; a conversation only its recorder (table, id, patch). visibility: change who can see an item the user recorded (table, id, visibility). delete: delete an item the user recorded or a shared one of the partner's; a conversation, with its items, only its recorder (table, id). rename: rename a person (id, name). alias: add another name a person goes by (id, alias). merge: merge the duplicate drop into the person id (id, drop). share_transcript: let the partner read the transcript of a conversation the user recorded, once nothing in it is private any more (id); a transcript never turns shared on its own. ungroup: take a person out of a group (id = the group's, person). group_rename: rename a group; its old name keeps finding it (id, name). group_alias / group_unalias: add or drop another name of a group, e.g. Kollegen for Arbeit (id, alias). group_merge: merge the group drop into the group id (id, drop). group_delete: delete a group for the user (id). gender: set or (null) clear a person's gender (id, gender), only when the user states it or uses a pronoun for the person, never from the name. to_relationship: turn a fact into a relationship, which keeps its visibility, and delete the fact (id = the fact's, from, to, label, inverse, note), e.g. the fact \"our landlady\" into from her to \"us\", label Vermieterin, inverse Mieter:in",
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
  from: Target.optional().describe('to_relationship: a person id, "me" or "us"'),
  to: Target.optional().describe('to_relationship: the other end; a person id, "me" or "us"'),
  label: z.string().optional().describe(`to_relationship: what \`from\` is to \`to\`. ${WORDS_DOC}`),
  inverse: z.string().optional().describe("to_relationship: what `to` is to `from`"),
  note: z.string().optional().describe("to_relationship: anything more about it"),
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
    .describe("Change fields of an item the user recorded, or of the partner's shared one (not a conversation)"),
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
    .describe("Delete an item the user recorded or the partner's shared one; a conversation, only its recorder, takes its items with it"),
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
    .object({ action: z.literal("to_relationship"), id: ItemId.describe("The fact's id"), from: Target, to: Target, label: z.string(), inverse: z.string(), note: z.string().optional() })
    .describe("Turn a fact into a relationship"),
]);

const PrivateItem = z.boolean().optional().describe("Makes just this item private");
const RememberInput = z.object({
  visibility: Visibility,
  genders: z
    .array(z.object({ person: PersonId, gender: Gender.nullable().describe("null when it isn't known") }))
    .optional()
    .describe("A person's gender, only when the user states it or uses a pronoun for them, never from the name"),
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
  counts: z.object({ facts: z.number().int(), promises: z.number().int(), dates: z.number().int(), exchanges: z.number().int(), genders: z.number().int() }),
  people: z.array(z.object({ id: PersonId, name: z.string(), url: z.string() })).describe("The people it is about, with a link to each"),
  filed: Filed.describe("Everything filed, with ids and links"),
  relabel: Relabels.describe("genders: the relationships the user may edit of each person given a gender, whose words are written in each end's gender"),
});

export const TOOLS: readonly Tool[] = [
  tool({
    name: "record_conversation",
    description:
      'File a conversation the user told you about, with the verbatim ramble as transcript, a short summary, who was involved and what was learned; use it after every ramble about meeting, calling or messaging someone. First resolve every person with find_person, ask the user when a name fits more than one person or resembles an existing one, and set confirmedNew on a new person only once the user said they are someone else. date is today unless the user says otherwise: when the user says when it happened ("the day before yesterday"), pass that day. If anything is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling, and keep it out of the summary. Who someone is to the household ("she\'s our landlady", "our neighbour", "my doctor") is a relationship to "us" (everyone in the household, one relationship each) or "me", never a fact: "we rent from her" is from her to "us", label Vermieterin, inverse Mieter:in. Facts: kind `situation` for what is going on and will end (moving, a new dog, looking for a car), with checkAfter estimated from how long it usually takes (a car: a few weeks, a house: months); everything else is `lasting`. News about a situation supersedes it (supersedes) and needs a new checkAfter: suggest one from what the news says and agree it with the user before filing; when the user tells how it ended, mark it outdated with correct. Set a person\'s gender only when the user states it or uses a pronoun for them ("she is our landlady"), never from the name.',
    input: NewConversation,
    output: Recorded,
    annotations: { destructiveHint: false },
    handler: async (v, c) => {
      const r = await recordConversation(v, c);
      return ok(Recorded, r, [
        `Read back in one or two sentences what you filed, with the day it happened (${c.date}) and the link in url.`,
        ...r.people.filter((p) => p.created).map((p) => `${p.name} is new in the book: say so in the read-back.`),
        ...r.filed.facts.flatMap(situationDay),
        ...r.filed.relationships.flatMap(keptRelationship),
        ...r.filed.groups.flatMap(alreadyInGroup),
      ]);
    },
  }),
  tool({
    name: "remember",
    description:
      "File what the user tells you about people the book already has when it isn't a conversation: a birthday or another date, a fact, a promise, a gift idea or another exchange (\"Malou's birthday is 7 February 2024\", \"Anna's new job is at the museum\"). Resolve every person with find_person first; for someone not in the book yet, or when the user is telling about a meeting, call or message, use record_conversation instead. If anything is sensitive, ask the user whether it should be private before calling. Facts: kind `situation` for what is going on and will end (moving, a new dog, looking for a car), with checkAfter estimated from how long it usually takes (a car: a few weeks, a house: months); everything else is `lasting`. News about a situation supersedes it (supersedes) and needs a new checkAfter: suggest one from what the news says and agree it with the user before filing; when the user tells how it ended, mark it outdated with correct. A role (\"our landlady\") is not a fact: file it with relate. genders sets a person's gender, only when the user states it or uses a pronoun for them, never from the name; it returns the relationships to relabel.",
    input: RememberInput,
    output: RememberedJson,
    annotations: { destructiveHint: false },
    handler: async (v, r) => {
      const out = await remember(v, r);
      // A relationship between two people given a gender is listed once; `next` still names each end's word.
      const relabels = [...new Map(out.genders.flatMap((g) => g.relabel).map((r) => [r.id, r])).values()];
      return ok(RememberedJson, { ...out, relabel: relabels }, [
        ...out.filed.facts.flatMap(situationDay),
        ...out.genders.flatMap((g) => relabel(g.person, g.gender, g.relabel)),
      ]);
    },
  }),
  tool({
    name: "find_person",
    description:
      "Find people by name or alias, tolerant of spelling, each with context that tells people of the same name apart; always call this before referring to a person by id.",
    input: z.object({
      name: z.string().describe("A name or alias, as the user said it"),
    }),
    output: FoundJson,
    annotations: { readOnlyHint: true },
    handler: async (v, { name }) => {
      const people = await findPeople(v, name);
      return ok(FoundJson, { people }, foundNext(name, people));
    },
  }),
  tool({
    name: "briefing",
    description:
      "Everything worth knowing about a person: who they are to the household (`roles`, read from the user's side: `us`, `me`, or `partner` with the partner's name), what is going on (`situations`, with `nudge` once their day to ask has come), what stays true (`known`), the one-hop `network`, when the user last saw them, recent conversations, open promises and exchanges, gift ideas, upcoming dates and relationships. A fact read from a social media screenshot the user shared carries its `source` (Instagram, LinkedIn, ...) and `happenedOn`. Each relationship has its id, its words (label: what from is to to; inverse: what to is to from) and note, so a wrong or doubled one can be fixed with correct (table `relationships`, patch { label, inverse, note }). Use it before the user meets someone, when they ask about a person, or \"how do I know X?\".",
    input: z.object({ personId: PersonId }),
    output: BriefingOut,
    annotations: { readOnlyHint: true },
    handler: async (v, { personId }) => {
      const b = await briefing(v, personId);
      return ok(BriefingOut, b, briefingNext(b));
    },
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
    handler: async (v, { from, horizonDays }) => {
      const items = await whatsDue(v, from, horizonDays);
      return ok(
        DueJson,
        { items },
        items.filter((i) => i.kind === "situation").map((i) => `Suggest asking ${i.name} about "${i.text}": its day to ask, ${i.date}, has come.`),
      );
    },
  }),
  tool({
    name: "relate",
    description:
      "Record how two people are related, or put people in a group, when the user mentions it outside of a conversation to file; pass person ids from find_person. If it is sensitive (health, relationship trouble, money, anything said in confidence), ask the user whether it should be private before calling. Who someone is to the household (\"she's our landlady\") is a relationship to \"us\" (everyone in the household, one relationship each) or \"me\", never a fact: from her, to \"us\", label Vermieterin, inverse Mieter:in. Filing the same relationship again, either way round or in another gender form, keeps the one there.",
    input: RelateInput,
    output: RelatedJson,
    annotations: { destructiveHint: false },
    handler: async (v, input) => {
      const a = check(RelateArgs, input);
      if (a.kind === "group") {
        const g = await addToGroup(v, { name: a.name, members: a.members, visibility: a.visibility });
        return ok(RelatedJson, g, alreadyInGroup(g));
      }
      const { ids, relationships } = await addRelationship(v, { from: a.from, to: a.to, label: a.label, inverse: a.inverse, note: a.note, visibility: a.visibility });
      return ok(RelatedJson, { id: ids[0], ids, relationships, url: personPath(isHouseholdWord(a.from) ? a.to : a.from) }, relationships.flatMap(keptRelationship));
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
      "The user's calendar feed: a secret ICS URL with every birthday (yearly, with the age when the year is known), the other dates and their own promises with a due date, to subscribe to in Google Calendar (\"From URL\") or any calendar app. `show` makes one when the user has none; an existing one can't be shown again (only its hash is kept). `replace` makes a new URL and `revoke` turns the feed off; both stop the old URL at once, so calendars subscribed to it go empty: ask the user before either.",
    input: z.object({
      action: z.enum(CALENDAR_ACTIONS).default("show").describe("`show` (default) makes a feed when there is none; `replace` makes a new URL; `revoke` turns it off"),
    }),
    output: CalendarFeed,
    annotations: { destructiveHint: true },
    handler: async (v, { action }) => {
      if (action === "revoke") {
        await revokeCalendarKey(v);
        return ok(CalendarFeed, { active: false, created: false, url: null }, ["The feed is off: calendars subscribed to it go empty."]);
      }
      if (action === "show" && (await hasCalendarKey(v)))
        return ok(CalendarFeed, { active: true, created: false, url: null }, [
          "The user already has a feed, whose URL can't be shown again: tell them, and offer replace, which makes a new URL and stops the old one at once.",
        ]);
      const replaced = action === "replace" && (await hasCalendarKey(v));
      return ok(CalendarFeed, { active: true, created: true, url: feedPath(await createCalendarKey(v)) }, [
        ...(replaced ? ["The old URL has stopped working: calendars subscribed to it need the new one."] : []),
        'Give the URL only to the user: anyone who has it can read these dates. In Google Calendar it goes under "From URL", which refreshes every few hours.',
      ]);
    },
  }),
  tool({
    name: "correct",
    description:
      "Fix something already filed: mark a promise done or an exchange settled, mark a fact outdated, edit or delete an item, change who can see it, rename a person or add an alias, set a person's gender (only when the user states it or uses a pronoun for them, never from the name; it returns the relationships to relabel), turn a fact into a relationship, merge a duplicate or let the partner read a transcript. A fact moves between lasting and situation with edit, patch { kind, checkAfter }. Use it when the user says something is done, no longer true or wrong. If the conversation was on another day: edit, table conversations, patch { date }.",
    input: CorrectInput,
    output: CorrectedJson,
    annotations: { destructiveHint: true },
    handler: async (v, input) => {
      const a = check(CorrectArgs, input);
      const corrected = true as const;
      switch (a.action) {
        case "gender": {
          const { relabel: rels } = await setGender(v, a.id, a.gender);
          return ok(CorrectedJson, { corrected, relabel: rels }, relabel(a.id, a.gender, rels));
        }
        case "outdated": {
          const fact = await markOutdated(v, a.id);
          return ok(
            CorrectedJson,
            { corrected, fact },
            fact.kind === "situation"
              ? [`${fact.name}'s situation "${fact.text}" is outdated. When the user has told how it ended, file the outcome as a lasting fact with remember, if it is worth keeping.`]
              : [],
          );
        }
        case "edit": {
          const { fact } = await editItem(v, a.table, a.id, a.patch);
          return ok(
            CorrectedJson,
            { corrected, fact },
            !fact ? [] : "kind" in a.patch && isTrait(fact.kind) ? nowTrait(fact.name, fact.text, fact.kind) : "kind" in a.patch || "checkAfter" in a.patch ? situationDay(fact) : [],
          );
        }
        case "merge": {
          const m = await mergePeople(v, a.id, a.drop);
          return ok(CorrectedJson, { corrected, moved: m.moved }, merged(m));
        }
        case "to_relationship": {
          const { relationships } = await factToRelationship(v, a.id, { from: a.from, to: a.to, label: a.label, inverse: a.inverse, note: a.note });
          return ok(CorrectedJson, { corrected, relationships }, relationships.flatMap(keptRelationship));
        }
        case "done":
          await markDone(v, a.table, a.id);
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
      return ok(CorrectedJson, { corrected });
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
      return ok(
        TranscriptJson,
        { conversationId: c.id, url: conversationPath(c.id), date: c.date, transcript: c.transcript },
        c.transcript === null ? ["The transcript is private to whoever recorded it: answer from the conversation's summary instead."] : [],
      );
    },
  }),
];

export const toolByName = (name: string): Tool | undefined => TOOLS.find((t) => t.name === name);
