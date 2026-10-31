// Tests only: fails any query on a book table that doesn't name its book_id, so a query that went around the scope can't pass CI.
// It walks the whole query, subqueries included; joins are left alone (the composite keys keep them in the book). A whole raw query
// that reads a book table fails too. Never installed in production: the scope is the mechanism, this is the second check.
import type { KyselyPlugin, OperationNode, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from "kysely";
import { isBookTable } from "./tables";

type Node = OperationNode & Record<string, unknown>;
const isNode = (x: unknown): x is Node => typeof x === "object" && x !== null && typeof (x as Node).kind === "string";

function children(n: unknown): unknown[] {
  if (Array.isArray(n)) return n;
  if (typeof n !== "object" || n === null) return [];
  return Object.values(n);
}

function* walk(n: unknown): Generator<Node> {
  for (const c of children(n)) {
    if (Array.isArray(c)) yield* walk(c);
    else if (isNode(c)) {
      yield c;
      yield* walk(c);
    }
  }
}

const identifier = (n: unknown): string | undefined => (isNode(n) && n.kind === "IdentifierNode" ? (n.name as string) : undefined);
const tableName = (n: unknown): string | undefined => (isNode(n) && n.kind === "TableNode" ? identifier((n.table as Node).identifier) : undefined);

// A root table and the name its columns are referred to by: `persons` → persons, `persons as p` → p.
function root(n: unknown): { table: string; name: string } | undefined {
  if (!isNode(n)) return undefined;
  if (n.kind === "AliasNode") {
    const table = tableName(n.node);
    const alias = identifier(n.alias);
    return table && alias ? { table, name: alias } : undefined;
  }
  const table = tableName(n);
  return table ? { table, name: table } : undefined;
}

// Whether a where clause refers to `<name>.book_id`.
function namesBook(where: unknown, name: string): boolean {
  for (const n of [where, ...walk(where)]) {
    if (!isNode(n) || n.kind !== "ReferenceNode") continue;
    const column = isNode(n.column) ? identifier(n.column.column) : undefined;
    if (column === "book_id" && (n.table === undefined || tableName(n.table) === name)) return true;
  }
  return false;
}

function check(node: Node): void {
  const queries = [node, ...walk(node)].filter((n) => ["SelectQueryNode", "UpdateQueryNode", "DeleteQueryNode"].includes(n.kind));
  for (const q of queries) {
    const roots = q.kind === "UpdateQueryNode" ? [q.table] : children((q.from as Node | undefined)?.froms);
    for (const r of roots.map(root)) if (r && isBookTable(r.table) && !namesBook(q.where, r.name)) throw new Error(`unscoped query on ${r.table}`);
  }
  // A whole query in raw SQL; raw fragments inside a scoped query (the recursive places queries) start from scoped ids.
  if (node.kind === "RawNode") {
    const text = (node.sqlFragments as string[]).join(" ");
    for (const m of text.matchAll(/\b(?:from|join|update|into)\s+"?(\w+)"?/gi)) if (isBookTable(m[1])) throw new Error(`unscoped query on ${m[1]}`);
  }
}

export class BookCheck implements KyselyPlugin {
  transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
    check(node as unknown as Node);
    return node;
  }
  async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return result;
  }
}
