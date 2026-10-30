// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them. The
// vocabularies come from backend/types.ts; the rules on the values stay in the domain functions,
// which answer a bad value with `invalid_input`.
import * as z from "zod";
import { CONVERSATION_KINDS, EXCHANGE_KINDS, FACT_CATEGORIES, FACT_KINDS, GENDERS, LANGUAGES, LOOK_PARTS, SEARCH_KINDS, VISIBILITIES } from "../types";
import type { PlaceRef } from "../places";
import { ERROR_CODES } from "./errors";

export const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).describe("Stable machine-readable code"),
  })
  .meta({ id: "Error" });

export const Visibility = z.enum(VISIBILITIES).describe("`private` items are visible only to whoever recorded them");
export const Day = z.string().describe("A day, `YYYY-MM-DD`");
/** How a part names where it happened: also where that place sits, its address, and whose home it is. */
const placeExtras = {
  in: z
    .lazy(() => PlaceRefJson)
    .optional()
    .describe("The place it sits inside, as far as the user said (the Olympiahalle in München): same forms, and may say where that sits"),
  address: z.string().optional().describe("Its address in words, as the user told it"),
  owners: z
    .array(z.union([z.number().int().min(0), z.enum(["me", "us"])]))
    .optional()
    .describe('Whose home it is ("at Anna\'s"): people by index, or "me"/"us"'),
  ownersPrivate: z.boolean().optional().describe("Whose home it is was told in confidence"),
};
export const PlaceRefJson: z.ZodType<PlaceRef<number>> = z
  .union([
    z.string().describe("The place's name or another name it goes by: an exact match is reused, a close one is refused as ambiguous"),
    z.object({ id: z.string().describe("An existing place's id"), ...placeExtras }),
    z.object({ name: z.string(), confirmedNew: z.boolean().optional().describe("The user confirmed it is a new place, not the close one"), ...placeExtras }),
  ])
  .describe("Where it happened: a place's name, { id }, or { name, confirmedNew: true }, each optionally with in, address and owners")
  .meta({ id: "PlaceRef" });
export const PersonId = z.string().describe("A person's id");
const Url = z.string().describe("Where it opens in the web app, as an absolute URL");
// An item links to its row on the page that shows it, which scrolls to the row and highlights it.
const ItemUrl = Url.describe("Where it opens in the web app, as an absolute URL to its highlighted row");

export const Gender = z
  .enum(GENDERS)
  .describe("The person's gender, which the role labels follow; set only when the user states it or uses a pronoun for the person, never from the name");
export const LookJson = z
  .object({
    face: z.enum(LOOK_PARTS.face).describe("The shape of the face"),
    skin: z.enum(LOOK_PARTS.skin).describe("Skin tone, lightest to darkest"),
    hair: z.enum(LOOK_PARTS.hair).describe("Hair style: none is bald, buzz a very short cut, wavy reaches the chin, long the shoulders"),
    hairColor: z.enum(LOOK_PARTS.hairColor).describe("Hair color; also the color of the brows and beard"),
    glasses: z.enum(LOOK_PARTS.glasses),
    beard: z.enum(LOOK_PARTS.beard),
    description: z
      .string()
      .nullable()
      .optional()
      .describe(
        'How the user described them, in their words ("kurze lockige braune Haare, Brille"), kept so the look can be chosen again; null when put together by hand',
      ),
  })
  .describe(
    "A stylized avatar put together from parts, not a portrait: choose for each part the value closest to how the user described the person, and the usual value (none, oval) for what they didn't say",
  )
  .meta({ id: "Look" });
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
    createdFrom: z
      .string()
      .nullable()
      .optional()
      .describe("The conversation the person was first mentioned in, when the viewer may see it; absent in a search"),
    context: z.array(z.string()).optional().describe("Only in a search: short hints that tell people with the same name apart"),
    gender: Gender.nullable().optional().describe("null when it isn't known; absent in a search"),
    look: LookJson.nullable().optional().describe("The parts of their avatar; null while nobody described them; absent in a search"),
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
const Own = {
  visibility: Visibility,
  mine: z.boolean().describe("Whether the caller recorded it; only then may they change its visibility. A shared item either user may edit or delete"),
};

const FactJson = {
  id: z.string(),
  text: z.string(),
  category: z.enum(FACT_CATEGORIES),
  url: ItemUrl,
  source: z.string().optional().describe("Where it was posted (Instagram, LinkedIn, ...), for a fact read from a shared file"),
  happenedOn: Day.optional().describe("When it happened, when the file showed it"),
  imageUrl: Url.optional().describe("The file it was read from (sign-in required)"),
  ...Own,
};

const Traits = z
  .object({
    needs: z.array(z.object(FactJson)).describe("Facts of kind need: what to plan around when meeting or inviting them"),
    personality: z.array(z.object(FactJson)).describe("Facts of kind personality: how the person is"),
  })
  .describe("What the person needs and how they are, each as filed");

export const TraitsJson = z
  .object({
    people: z
      .array(z.object({ id: z.string(), name: z.string(), url: Url, ...Traits.shape }))
      .describe("Each person once: the people named first, in the order given, then each group's members by name"),
  })
  .meta({ id: "Traits" });

export const JournalEntryJson = z
  .object({
    id: z.string(),
    date: Day,
    text: z.string(),
    people: z.array(z.object({ id: PersonId, name: z.string(), url: Url })).describe("The people it names"),
    rambleId: z.string(),
    visibility: Visibility,
    mine: z.boolean().describe("The caller wrote it: they may edit, share or delete it"),
    url: Url.describe("The entry on the Tagebuch page, as an absolute URL"),
  })
  .meta({ id: "JournalEntry" });
export const JournalJson = z.object({ entries: z.array(JournalEntryJson.extend({})).describe("Newest first") }).meta({ id: "Journal" });
export const SearchHitJson = z
  .object({
    kind: z
      .enum(SEARCH_KINDS)
      .describe(
        "What matched: a ramble's `transcript`, a `conversation`, an `experience`, a `journal` entry, an item about a person (`fact`, `promise`, `exchange`, `date`) or a `place`",
      ),
    id: z.string(),
    date: Day.nullable().describe("The day it was told or happened; null for a place"),
    text: z.string().describe("The matching text, cut around the first match when it is long"),
    people: z.array(z.string()).describe("Who it is about or who was there, by name"),
    url: Url,
    rambleId: z.string().nullable().describe("The ramble it was told in, when there is one"),
  })
  .meta({ id: "SearchHit" });
export const SearchJson = z.object({ hits: z.array(SearchHitJson).describe("Newest first") }).meta({ id: "Search" });
export const SearchQuery = z.object({
  q: z.string().describe("The words to find; every one must occur, in any case, umlauts folded. At most 20 hits"),
});
export const JournalQuery = z.object({
  from: Day.optional().describe("The first day; 30 days before `to` when left out"),
  to: Day.optional().describe("The last day; today when left out"),
  personId: PersonId.optional().describe("Only the entries that name this person"),
});

const Linked = z.object({ id: z.string(), name: z.string(), url: Url });
export const ExperienceJson = z
  .object({
    id: z.string(),
    date: Day,
    kind: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    place: Linked.nullable(),
    series: Linked.nullable(),
    people: z.array(Linked).describe("Who else was there"),
    rambleId: z.string(),
    visibility: Visibility,
    mine: z.boolean().describe("The caller recorded it: they may change or delete it"),
    url: Url,
  })
  .meta({ id: "Experience" });
export const SeriesSummaryJson = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    rhythmDays: z.number().int().nullable(),
    startsOn: Day.nullable(),
    endsOn: Day.nullable(),
    url: Url,
  })
  .meta({ id: "SeriesSummary" });
export const ExperiencesJson = z
  .object({
    experiences: z.array(ExperienceJson.extend({})).describe("Newest first"),
    kinds: z.array(z.string()).describe("The kinds in use, most used first"),
    series: z.array(SeriesSummaryJson.extend({})).describe("The series in use, by name"),
  })
  .meta({ id: "Experiences" });
export const ExperienceQuery = z.object({
  from: Day.optional(),
  to: Day.optional(),
  kind: z.string().optional().describe("Only this kind, in any case"),
  placeId: z.string().optional(),
  seriesId: z.string().optional(),
  personId: PersonId.optional().describe("Only those this person was at"),
});
export const PlaceJson = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    parents: z.array(Linked).describe("The places it sits inside, nearest first"),
    address: z.string().nullable().describe("Its address in words, as told"),
    owners: z.array(Linked).describe("Whose home it is"),
    url: Url,
  })
  .meta({ id: "Place" });
export const PlaceListJson = z
  .array(
    PlaceJson.extend({
      times: z.number().int().optional().describe("person: how often the person was there with the caller"),
      last: Day.optional().describe("person: when last"),
    }),
  )
  .meta({ id: "PlaceList" });
export const SeriesJson = SeriesSummaryJson.extend({
  place: Linked.nullable(),
  sessions: z.array(ExperienceJson.extend({})).describe("Its sessions the caller may see, oldest first"),
  skipped: z.array(Day).describe("Session days marked as skipped"),
  missed: z.array(Day).describe("The latest session day that passed untold, if any"),
  visibility: Visibility,
  mine: z.boolean(),
}).meta({ id: "Series" });
export const PlaceViewJson = PlaceJson.extend({
  inside: z.array(PlaceJson.extend({})).describe("The places directly inside it"),
  experiences: z.array(ExperienceJson.extend({})),
  conversations: z.array(z.object({ id: z.string(), date: Day, summary: z.string(), url: Url })),
  series: z.array(SeriesSummaryJson.extend({})),
}).meta({ id: "PlaceView" });

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
      look: LookJson.nullable().describe("The parts of their avatar and the user's words for how they look; null while nobody described them"),
    }),
    roles: z
      .array(
        z.object({
          label: z.string().describe("What the person is to the household, in the words filed: Vermieterin, Ärztin, Klempner"),
          with: z
            .enum(["me", "partner", "us"])
            .describe("To whom, from the caller's side: `us` both of the household, `me` the caller, `partner` the other user"),
          partnerName: z.string().optional().describe("The other user's name, when `with` is `partner`"),
          ids: z.array(z.string()).describe("The relationships it stands for (table `relationships`), one per household person"),
        }),
      )
      .describe('Who the person is to the household ("your landlady", "Sybille\'s colleague"): the first thing to say about them'),
    groups: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          url: Url,
          private: z.boolean().describe("Whether the caller's own private membership is the only one they see"),
        }),
      )
      .describe("The groups the caller may see the person in, each once"),
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
    traits: Traits,
    known: z.array(z.object(FactJson)).describe("What else stays true about the person, by category"),
    journal: z.array(JournalEntryJson.extend({})).describe("The caller's own journal entries that name the person, the last few, newest first"),
    experiences: z.array(ExperienceJson.extend({})).describe("The experiences the caller may see that the person was at, the last few, newest first"),
    homes: z.array(PlaceJson.extend({})).describe("Where the person lives: the places that are their home"),
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
        direction: z
          .enum(["out", "in"])
          .describe("`out` when the person is `from` (so `inverse` is what the other is to them), `in` when they are `to` (`label` is)"),
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
        edges: z.array(
          z.object({
            id: z.string(),
            from: PersonId,
            to: PersonId,
            label: z.string().describe("What `from` is to `to`"),
            inverse: z.string().describe("What `to` is to `from`"),
          }),
        ),
      })
      .describe("One hop around the person: the household persons they relate to, and their own people"),
    suggestedInterval: z
      .number()
      .int()
      .optional()
      .describe("Only while the interval isn't confirmed, only when the history is long enough to suggest one, and never for one of the household"),
  })
  .meta({ id: "Briefing" });

export const DueItemJson = z
  .object({
    kind: z
      .enum(["date", "promise", "overdue", "situation", "session"])
      .describe(
        "`situation`: something going on whose checkAfter has come; ask how it went. `session`: a session day of a series that passed untold (name: the series, itemId: its id); ask how it went or whether it was skipped",
      ),
    personId: PersonId,
    name: z.string(),
    date: z.string().optional(),
    text: z.string().optional(),
    ratio: z.number().optional(),
    byMe: z
      .boolean()
      .optional()
      .describe("On a promise: whether the caller made it (false: the person promised it to the caller). Only the caller's own promises are due"),
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
    ring: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .describe("0 seen recently, 1 drifting, 2 due or overdue, by the caller's own last seen and interval"),
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
  .object({
    name: z.string().optional().describe("The person's new name"),
    gender: Gender.nullable().optional().describe("The person's gender; null clears it"),
    look: LookJson.nullable().optional().describe("The person's look, all parts; null clears it"),
  })
  .refine((p) => p.name !== undefined || p.gender !== undefined || p.look !== undefined, "Give a name, a gender, a look, or several")
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
export const RelationshipIdsJson = z
  .object({ ids: z.array(z.string()).describe('One per pair; "us" is one per household person') })
  .meta({ id: "RelationshipIds" });

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

export const FileId = z.string().describe("A shared file's id, as inbox lists it. Only the caller's own waiting file");
const FileIds = z
  .array(FileId)
  .describe(
    "The shared files this conversation was told from: their transcripts (text word for word, or what a photo shows) join this one, and the files are deleted",
  );
export const NewConversationJson = z
  .object({
    fileIds: FileIds.optional(),
    date: Day,
    kind: z.enum(CONVERSATION_KINDS),
    place: PlaceRefJson.optional(),
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
          .describe(
            "A new person whose name matches an existing person's name or alias: only once the user confirmed it is someone else; otherwise `ambiguous`",
          ),
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
      .array(
        z.object({
          person: Ref,
          kind: z.enum(EXCHANGE_KINDS),
          direction: Direction,
          text: z.string(),
          amount: z.number().optional(),
          currency: z.string().optional(),
          private: Private,
        }),
      )
      .optional(),
    relationships: z
      .array(
        z.object({
          from: z.union([Ref, HOUSEHOLD_TARGET]),
          to: z.union([Ref, HOUSEHOLD_TARGET]),
          label: LABEL,
          inverse: INVERSE,
          note: z.string().optional().describe('Anything more about it: "seit der Schulzeit"'),
          private: Private,
        }),
      )
      .optional()
      .describe('How people are related, and who someone is to the household: a role ("our landlady") goes to "us" or "me", never into a fact'),
    groups: z.array(z.object({ name: z.string(), members: z.array(Ref), private: Private })).optional(),
  })
  .meta({ id: "NewConversation" });

// A ramble and its parts: the conversation's item lists, each item optionally `in` one of the ramble's conversations.
const In = z.number().int().optional().describe("The index in conversations of the conversation this came from; leave out when it came from no conversation");
const C = NewConversationJson.shape;
export const NewRambleJson = z
  .object({
    fileIds: FileIds.optional(),
    date: Day.describe("The day the user told it: today unless they say otherwise"),
    transcript: C.transcript,
    visibility: Visibility,
    people: z
      .array(C.people.element.omit({ present: true }))
      .describe("Everyone the ramble names, each once; conversations, journal entries and items refer to them by index"),
    conversations: z
      .array(
        z.object({
          date: Day.optional().describe("When it happened, when not the ramble's day"),
          kind: C.kind,
          place: C.place,
          summary: C.summary,
          present: z.array(Ref).describe("Who took part, by index into people"),
          at: z.number().int().optional().describe("The experience it happened at, by index into experiences (the talk with Anna at the festival)"),
        }),
      )
      .optional()
      .describe("The meetings, calls and messages it tells of, each its own conversation"),
    experiences: z
      .array(
        z.object({
          date: Day.optional().describe("The day it happened, when not the ramble's day"),
          kind: z.string().describe('A word in the user\'s language for what it was ("Konzert", "Festival", "Kurs", "Reise"); reuse a kind already in use'),
          title: z.string().describe('A short title ("Wanda in der Olympiahalle", "Hundeschule, 2. Stunde")'),
          summary: z.string().optional().describe("A few lines of what happened; how it felt to the user goes in a journal entry"),
          place: PlaceRefJson.optional(),
          present: z.array(Ref).optional().describe("Who else was there, by index into people; the user always is"),
          series: z
            .union([
              z.string().describe("An existing series' id"),
              z.object({
                name: z.string().describe("The series' name; an existing one of that exact name is reused"),
                kind: z.string().optional(),
                rhythmDays: z.number().int().optional().describe('How often it happens, in days (7 for "every Wednesday"); leave out when it has no rhythm'),
                startsOn: Day.optional().describe("Its first day, when not this session's"),
                endsOn: Day.optional().describe("Its last day, when known"),
              }),
            ])
            .optional()
            .describe(
              "The series this is a session of (a course, a weekly training). Start a new one only when the user speaks of it as recurring, and ask first",
            ),
          private: z.boolean().optional().describe("Only for this experience; a private ramble or series makes it private anyway"),
        }),
      )
      .optional()
      .describe("What the user lived through that isn't a meeting: a concert, a festival, a trip, a lesson"),
    journal: z
      .array(
        z.object({
          date: Day.optional().describe("The day it is about, when not the ramble's day"),
          text: z.string().describe("The entry in the user's own words: what they think, feel or plan about their own life"),
          mentions: z.array(Ref).optional().describe("The people it names, by index into people"),
          shared: z.boolean().optional().describe("Only when the user says to share this entry with the household; private otherwise"),
        }),
      )
      .optional()
      .describe("Journal entries about the user themselves, cut from the ramble"),
    facts: z.array(C.facts.unwrap().element.extend({ in: In })).optional(),
    promises: z.array(C.promises.unwrap().element.extend({ in: In })).optional(),
    dates: z.array(C.dates.unwrap().element.extend({ in: In })).optional(),
    exchanges: z.array(C.exchanges.unwrap().element.extend({ in: In })).optional(),
    relationships: z.array(C.relationships.unwrap().element.extend({ in: In })).optional(),
    groups: z.array(C.groups.unwrap().element.extend({ in: In })).optional(),
  })
  .meta({ id: "NewRamble" });

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
  dates: z.array(
    z.object({ ...Filed, kind: z.enum(["birthday", "anniversary", "custom"]), date: z.string(), label: z.string().nullable(), yearly: z.boolean() }),
  ),
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

export const RecordedRambleJson = RecordedJson.omit({ conversationId: true, url: true })
  .extend({
    rambleId: z.string(),
    conversations: z.array(z.object({ id: z.string(), url: Url.describe("The conversation's page, as an absolute URL") })),
    journal: z.array(z.object({ id: z.string(), visibility: Visibility, url: Url.describe("The entry on the Tagebuch page, as an absolute URL") })),
    experiences: z.array(
      z.object({
        id: z.string(),
        seriesId: z.string().nullable(),
        visibility: Visibility,
        url: Url.describe("The experience on its series' or ramble's page"),
      }),
    ),
  })
  .meta({ id: "RecordedRamble" });

const Name = z.string().describe("The name of the person it is about");
const Item = {
  id: z.string(),
  visibility: Visibility,
  recordedBy: z.string().describe("The id of the user who recorded it"),
  url: ItemUrl.describe("Its highlighted row on the conversation's page, as an absolute URL"),
};

export const ConversationJson = z
  .object({
    id: z.string(),
    date: Day,
    kind: z.enum(CONVERSATION_KINDS),
    place: z.string().nullable().describe("The place's name"),
    placeId: z.string().nullable(),
    summary: z.string(),
    transcript: z.string().nullable().describe("Null when the viewer may not read it"),
    visibility: Visibility,
    recordedBy: z.string(),
    url: Url,
    participants: z.array(z.object({ id: PersonId, name: z.string(), url: Url })),
    facts: z.array(
      z.object({ ...Item, personId: PersonId, name: Name, text: z.string(), category: z.enum(FACT_CATEGORIES), status: z.enum(["current", "outdated"]) }),
    ),
    promises: z.array(
      z.object({ ...Item, personId: PersonId, name: Name, text: z.string(), byMe: ByMe, by: PromiseBy, due: z.string().nullable(), done: z.boolean() }),
    ),
    dates: z.array(
      z.object({
        ...Item,
        personId: PersonId,
        name: Name,
        kind: z.enum(["birthday", "anniversary", "custom"]),
        date: z.string(),
        label: z.string().nullable(),
        yearly: z.boolean(),
      }),
    ),
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
    relationships: z.array(
      z.object({
        ...Item,
        fromId: PersonId,
        fromName: z.string(),
        toId: PersonId,
        toName: z.string(),
        label: z.string(),
        inverse: z.string(),
        note: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "Conversation" });

export const ItemPatchJson = z
  .object({
    done: z.literal(true).optional().describe("Marks a promise done or an exchange settled"),
    outdated: z.literal(true).optional().describe("Marks a fact outdated"),
    visibility: Visibility.optional().describe("Changes who can see the item (only its recorder may)"),
    patch: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("New values for the item's own fields (its recorder, or either user for a shared item; a conversation only its recorder)"),
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
    household: z
      .boolean()
      .describe(
        "The household's own group (Haushalt to start with): everyone who signs in is in it. It may be renamed, but not deleted, merged into another group or emptied of them",
      ),
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
export const GroupNameJson = z
  .object({ name: z.string().describe("A group's name; one that already names a group finds that group") })
  .meta({ id: "GroupName" });
export const GroupMergeJson = z.object({ drop: z.string().describe("The group to merge into the one in the path; it is deleted") }).meta({ id: "GroupMerge" });
export const DueListJson = z.array(DueItemJson).meta({ id: "DueList" });
export const OrbitJson = z.array(OrbitFaceJson).meta({ id: "Orbit" });

export const SettingsJson = z
  .object({
    webhookUrl: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .describe("Where the daily reminders are POSTed (ntfy-compatible); null for none. Only http and https"),
    language: z
      .enum(LANGUAGES)
      .optional()
      .describe(
        "The language the web app and the notifications speak to the caller; German by default. Always in a GET; a PUT ignores it (PUT /me/language sets it)",
      ),
  })
  .meta({ id: "Settings" });

export const LanguageJson = z
  .object({ language: z.enum(LANGUAGES).describe("The language the web app and the notifications speak to the caller") })
  .meta({ id: "Language" });

export const ReflectionJson = z
  .object({
    reflection: z
      .object({
        day: z.number().int().min(0).max(6).describe("Weekday, 0 = Sunday, in the server's time zone"),
        hour: z.number().int().min(0).max(23).describe("Hour of the day"),
      })
      .nullable()
      .describe("When the weekly reflection on your journal is pushed to your webhook; null for off (the default)"),
  })
  .meta({ id: "Reflection" });

export const SentJson = z.object({ sent: z.boolean().describe("Whether the receiver accepted the message") }).meta({ id: "Sent" });

const Candidate = z.object({ id: z.string(), name: Name, url: Url });
export const PendingFileJson = z
  .object({
    id: z.string(),
    status: z
      .enum(["reading", "pending", "failed"])
      .describe("`reading`: Claude is pre-reading it; `pending`: waits to be worked through; `failed`: couldn't be pre-read (see `error`; retry or discard)"),
    createdAt: z.number().int().describe("When it was shared, ms since the epoch"),
    sharedOn: Day.describe("The day it was shared: date what it shows by this (unless it shows another day), not by the day it is reviewed"),
    url: Url.describe("The file itself (sign-in required)"),
    type: z.string().describe("image/webp, application/pdf, text/plain, or audio/* for a voice note (worked through as its transcript)"),
    summary: z.string().nullable().describe("What Claude suggests to file, in the sharing user's language; null while reading or when it failed"),
    transcript: z
      .string()
      .nullable()
      .describe("What the file says, word for word (or what a photo shows, or what a voice note says): all that is kept of it once filed"),
    people: z
      .array(z.object({ name: z.string(), person: Candidate.nullable(), candidates: z.array(Candidate) }))
      .describe("Who is in it: the person when certain, else candidates"),
    error: z.string().nullable().describe("Why the pre-read failed, when it did"),
    batchId: z.string().nullable().describe("The id of the share it came in with: files with the same one were shared together; null when shared alone"),
  })
  .meta({ id: "PendingFile" });
export const PendingFileListJson = z.array(PendingFileJson.extend({})).meta({ id: "PendingFileList" });
export const ShareKeyJson = z
  .object({ key: z.string().describe("The share key; shown only now. Send it as `Authorization: Bearer <key>` to /api/share") })
  .meta({ id: "ShareKey" });

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

export const COMPONENTS = [
  LanguageJson,
  LookJson,
  SearchHitJson,
  SearchJson,
  PlaceRefJson,
  PendingFileJson,
  PendingFileListJson,
  ShareKeyJson,
  CalendarFeedJson,
  PersonPatchJson,
  FactRelationshipJson,
  RelationshipIdsJson,
  GroupJson,
  GroupListJson,
  GroupDetailJson,
  GroupNameJson,
  GroupMergeJson,
  SettingsJson,
  ReflectionJson,
  SentJson,
  ErrorJson,
  PersonJson,
  PersonListJson,
  BriefingJson,
  TraitsJson,
  JournalEntryJson,
  JournalJson,
  ExperienceJson,
  SeriesSummaryJson,
  ExperiencesJson,
  PlaceJson,
  PlaceListJson,
  SeriesJson,
  PlaceViewJson,
  NewRambleJson,
  RecordedRambleJson,
  DueItemJson,
  DueListJson,
  OrbitFaceJson,
  OrbitJson,
  IntervalJson,
  MergeJson,
  AliasJson,
  NewConversationJson,
  RecordedJson,
  ConversationJson,
  ItemPatchJson,
];

export const IdParam = z.string().describe("The id");
export const TableParam = z.string().describe("The kind of item: `facts`, `promises`, `dates`, `exchanges`, `relationships` or `conversations`");
export const TraitsQuery = z.object({
  people: z.string().optional().describe("Person ids, comma-separated"),
  groups: z.string().optional().describe("Group ids, comma-separated; each stands for the members the caller sees"),
});
export const PeopleQuery = z.object({
  q: z.string().optional().describe("A name or alias to search for; best matches first, at most 5. Without it, every person"),
});
