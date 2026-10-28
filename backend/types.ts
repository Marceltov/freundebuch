// The vocabulary the backend shares. Strings here are what is stored in the database and what the tools accept; the arrays let
// the backend and the schemas of the surfaces check them at run time.
export const VISIBILITIES = ["shared", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export type Viewer = { userId: string; personId: string };
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
/** A person's gender, which the words of their relationships are written in; null when it isn't known. */
export const GENDERS = ["female", "male", "nonbinary"] as const;
export type Gender = (typeof GENDERS)[number];
