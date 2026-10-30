// The vocabulary the backend shares. Strings here are what is stored in the database and what the tools accept; the arrays let
// the backend and the schemas of the surfaces check them at run time.
export const VISIBILITIES = ["shared", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
/** Who is looking: a user, their own person, and the household whose book they are in (ADR 0022). */
export type Viewer = { userId: string; personId: string; householdId: string };
export const CONVERSATION_KINDS = ["in_person", "call", "message", "video", "event"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
export const FACT_CATEGORIES = ["work", "home", "family", "health", "hobby", "travel", "other"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export const EXCHANGE_KINDS = ["gift_idea", "gift", "money", "lent", "help"] as const;
export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];
/**
 * A lasting fact is still true (works at Hornbach); a situation is going on and will end (moving, looking for a car). The traits
 * last too: a need is something to plan around (needs a wheelchair, vegetarian), a personality trait how the person is (gets angry
 * quickly).
 */
export const FACT_KINDS = ["lasting", "situation", "need", "personality"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const TRAIT_KINDS = ["need", "personality"] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];
export const isTrait = (kind: string): kind is TraitKind => (TRAIT_KINDS as readonly string[]).includes(kind);
/** The languages the app speaks, each user choosing their own; German is the default. */
export const LANGUAGES = ["de", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
/** Each language by its English name, for telling Claude which one to write in. */
export const LANGUAGE_NAMES: Record<Language, string> = { de: "German", en: "English" };
/** What a search hit is (backend/search.ts). */
export const SEARCH_KINDS = ["transcript", "conversation", "experience", "journal", "fact", "promise", "exchange", "date", "place"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
/** A person's gender, which the words of their relationships are written in; null when it isn't known. */
export const GENDERS = ["female", "male", "nonbinary"] as const;
export type Gender = (typeof GENDERS)[number];

/** A look (backend/looks.ts): every part of an avatar and the values it can take. */
export const LOOK_PARTS = {
  face: ["oval", "round", "long"],
  skin: ["light", "fair", "medium", "olive", "brown", "dark"],
  hair: ["none", "buzz", "short", "side-part", "curly", "wavy", "long", "bun", "ponytail", "afro"],
  hairColor: ["black", "dark-brown", "brown", "blond", "red", "grey", "white"],
  glasses: ["none", "round", "square"],
  beard: ["none", "stubble", "moustache", "short", "full"],
} as const;

export type LookPart = keyof typeof LOOK_PARTS;
export const LOOK_PART_NAMES = Object.keys(LOOK_PARTS) as LookPart[];
export type LookParts = { [P in LookPart]: (typeof LOOK_PARTS)[P][number] };
/** `description`: how the user described them, in their words; null when the look was put together by hand. */
export type Look = LookParts & { description: string | null };
