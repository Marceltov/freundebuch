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
export const RELATIONSHIP_TYPES = ["partner", "spouse", "parent", "child", "sibling", "friend", "colleague", "introduced_by", "other", "landlord", "neighbour", "doctor", "service"] as const;
/** `from` is `type` of `to` (`parent`: from is the parent of to; `landlord`, `doctor`: from is that to to; `service`: from works for
 * to, the note says what). partner, spouse, sibling, friend, colleague and neighbour are symmetric. */
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
/** A lasting fact is still true (works at Hornbach); a situation is going on and will end (moving, looking for a car). */
export const FACT_KINDS = ["lasting", "situation"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
/** A person's gender, which the role labels follow; null when it isn't known. */
export const GENDERS = ["female", "male", "nonbinary"] as const;
export type Gender = (typeof GENDERS)[number];
