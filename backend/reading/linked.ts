// A person's briefing across the user's books: one briefing per part (the person's row in each book, people/links.ts), each read
// alone in its book with the user's viewer there, so what the user may see stays what it is in that book; the parts are then
// merged into one, each item marked with the book it came from. A person of one book reads as that book's briefing.
import { instance } from "../db/scope";
import { NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { viewerIn, type BookRef } from "../people/books";
import { nameMatches, partsOf, sameAs, type Part } from "../people/links";
import type { Network, NetworkEdge } from "../people/network";
import type { Traits } from "../people/traits";
import { briefing, type Briefing } from "./briefing";

type Booked<T> = T extends Array<infer U> ? Array<U & { book?: BookRef }> : T;

/** The briefing with `book` on the items of each merged list (only when the person has several parts). */
export type LinkedBriefing = {
  [K in keyof Briefing]: K extends "traits"
    ? { [T in keyof Traits]: Booked<Traits[T]> }
    : K extends "open"
      ? { [O in keyof Briefing["open"]]: Booked<Briefing["open"][O]> }
      : K extends "network"
        ? { nodes: Network["nodes"]; edges: Array<NetworkEdge & { book?: BookRef }> }
        : Booked<Briefing[K]>;
} & {
  /** The person's rows in each book, oldest first. */
  parts: Part[];
  /** Whether the parts are one by the user's link (which they may undo), not by a writer of several books. */
  linked: boolean;
  /** People of the user's other books who may be the same person: ask the user. */
  sameAsAsk: Array<{ id: string; name: string; book: BookRef }>;
};

const mark = <T>(xs: T[], book: BookRef) => xs.map((x) => ({ ...x, book }));

/** The person's briefing across the user's books (`v`: the user in every book); NotFound when none of them holds the id. */
export async function linkedBriefing(v: Viewer, personId: string): Promise<LinkedBriefing> {
  const parts = await partsOf(v, personId);
  const i = await instance();
  const read = await Promise.all(
    parts.map(async (p) => {
      const w = await viewerIn(i, v.userId, p.book.id);
      if (!w) throw new NotFoundError(`No person with the id ${personId}`);
      return { book: p.book, b: await briefing(w, p.id) };
    }),
  );
  const [sameAsAsk, keys] = await Promise.all([nameMatches(v, personId), sameAs(v)]);
  const linked = !!keys.get(personId)?.startsWith("l:");
  if (read.length === 1) return { ...read[0].b, parts, linked, sameAsAsk };
  return { ...merge(read, keys), parts, linked, sameAsAsk };
}

function merge(read: { book: BookRef; b: Briefing }[], keys: Map<string, string>): Omit<LinkedBriefing, "parts" | "linked" | "sameAsAsk"> {
  const first = read[0].b;
  const all = <T>(pick: (b: Briefing) => T[]) => read.flatMap(({ book, b }) => mark(pick(b), book));
  const seen = read.map((r) => r.b.freshness).reduce((x, y) => ((y.lastSeen ?? "") > (x.lastSeen ?? "") ? y : x));
  const names = new Set(read.flatMap((r) => [r.b.person.name, ...r.b.person.aliases]));
  names.delete(first.person.name);
  const dates = new Set<string>();
  return {
    person: { ...first.person, aliases: [...names] },
    roles: all((b) => b.roles),
    groups: all((b) => b.groups),
    freshness: seen,
    nextDates: all((b) => b.nextDates)
      .filter((d) => {
        const key = `${d.kind}|${d.date}|${d.label ?? ""}`;
        if (dates.has(key)) return false;
        dates.add(key);
        return true;
      })
      .sort((x, y) => x.date.localeCompare(y.date)),
    situations: all((b) => b.situations),
    traits: { needs: all((b) => b.traits.needs), personality: all((b) => b.traits.personality) },
    known: all((b) => b.known),
    journal: all((b) => b.journal).sort((x, y) => y.date.localeCompare(x.date)),
    experiences: all((b) => b.experiences).sort((x, y) => y.date.localeCompare(x.date)),
    homes: all((b) => b.homes),
    card: read.find((r) => r.b.card)?.b.card ?? null,
    open: { promises: all((b) => b.open.promises), exchanges: all((b) => b.open.exchanges), giftIdeas: all((b) => b.open.giftIdeas) },
    recent: all((b) => b.recent).sort((x, y) => y.date.localeCompare(x.date)),
    relationships: all((b) => b.relationships),
    network: network(read, keys),
  };
}

// Every part's network as one: someone in several books (the user, a writer, a linked person) is one node, the id of the
// first part that has them; every edge keeps its book.
function network(read: { book: BookRef; b: Briefing }[], keys: Map<string, string>): LinkedBriefing["network"] {
  const canon = new Map<string, string>(); // identity → the node id kept
  const nodes: Network["nodes"] = [];
  const idOf = (id: string) => canon.get(keys.get(id) ?? id) ?? id;
  for (const { b } of read)
    for (const n of b.network.nodes) {
      const who = keys.get(n.id) ?? n.id;
      if (canon.has(who)) continue;
      canon.set(who, n.id);
      nodes.push(n);
    }
  // The person is one node too, whichever part drew them.
  const self = read[0].b.person.id;
  for (const { b } of read) canon.set(keys.get(b.person.id) ?? b.person.id, self);
  const kept = nodes.filter((n) => n.role !== "self" || n.id === self);
  const edges = read.flatMap(({ book, b }) => b.network.edges.map((e) => ({ ...e, from: idOf(e.from), to: idOf(e.to), book })));
  // Selves come first, then writers, then the others, as each book draws them.
  const order = { self: 0, writer: 1, other: 2 } as const;
  return { nodes: kept.sort((x, y) => order[x.role] - order[y.role]), edges };
}
