// The vocabulary the backend shares. Strings here are what is stored in the database and what the tools accept.
export type Visibility = "shared" | "private";
export type Viewer = { userId: string; personId: string };
export type ConversationKind = "in_person" | "call" | "message" | "video" | "event";
export type FactCategory = "work" | "home" | "family" | "health" | "hobby" | "travel" | "other";
export type ExchangeKind = "gift_idea" | "gift" | "money" | "lent" | "help";
/** `from` is `type` of `to` (`parent`: from is the parent of to). partner, spouse, sibling, friend and colleague are symmetric. */
export type RelationshipType = "partner" | "spouse" | "parent" | "child" | "sibling" | "friend" | "colleague" | "introduced_by" | "other";
