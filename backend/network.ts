// A person's one-hop network: the person, the household persons they have a relationship with, and their other people. Built only
// from relationships the caller already read through `visible`, so a private edge of the partner leaves no node, edge or gap.
import type { Gender } from "./types";
import { personPath } from "./urls";

export type NetworkNode = { id: string; name: string; gender: Gender | null; role: "self" | "household" | "other"; url: string };
/** One per relationship, as stored: `label` is what `from` is to `to`, `inverse` what `to` is to `from`. */
export type NetworkEdge = { id: string; from: string; to: string; label: string; inverse: string };
export type Network = { nodes: NetworkNode[]; edges: NetworkEdge[] };

type Rel = { id: string; from_id: string; to_id: string; label: string; inverse: string };

/** `rels` are the person's visible relationships, oldest first; `household` the household persons in order. */
export function buildNetwork(personId: string, rels: Rel[], household: string[], names: Map<string, string>, genders: Map<string, Gender | null>): Network {
  const others = rels.map((r) => (r.from_id === personId ? r.to_id : r.from_id));
  const linked = new Set(others);
  const ids = [personId, ...household.filter((h) => h !== personId && linked.has(h)), ...new Set(others.filter((o) => !household.includes(o)))];
  const role = (id: string): NetworkNode["role"] => (id === personId ? "self" : household.includes(id) ? "household" : "other");
  return {
    nodes: ids.map((id) => ({ id, name: names.get(id) ?? "", gender: genders.get(id) ?? null, role: role(id), url: personPath(id) })),
    edges: rels.map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, label: r.label, inverse: r.inverse })),
  };
}
