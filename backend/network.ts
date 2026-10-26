// A person's one-hop network: the person, the household persons they have a relationship with, and their other people. Built only
// from relationships the caller already read through `visible`, so a private edge of the partner leaves no node, edge or gap.
import type { Gender, RelationshipType } from "./types";
import { personPath } from "./urls";

export type NetworkNode = { id: string; name: string; gender: Gender | null; role: "self" | "household" | "other"; url: string };
/** One per relationship; `from` and `to` as stored, so the label depends on which end you read it from (see `RelationshipType`). */
export type NetworkEdge = { id: string; from: string; to: string; type: RelationshipType; note: string | null };
export type Network = { nodes: NetworkNode[]; edges: NetworkEdge[] };

type Rel = { id: string; from_id: string; to_id: string; type: string; note: string | null };

/** `rels` are the person's visible relationships, oldest first; `household` the household persons in order. */
export function buildNetwork(personId: string, rels: Rel[], household: string[], names: Map<string, string>, genders: Map<string, Gender | null>): Network {
  const others = rels.map((r) => (r.from_id === personId ? r.to_id : r.from_id));
  const linked = new Set(others);
  const ids = [personId, ...household.filter((h) => h !== personId && linked.has(h)), ...new Set(others.filter((o) => !household.includes(o)))];
  const role = (id: string): NetworkNode["role"] => (id === personId ? "self" : household.includes(id) ? "household" : "other");
  return {
    nodes: ids.map((id) => ({ id, name: names.get(id) ?? "", gender: genders.get(id) ?? null, role: role(id), url: personPath(id) })),
    edges: rels.map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, type: r.type as RelationshipType, note: r.note })),
  };
}
