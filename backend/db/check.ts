// Tests only: fails any query on a book table that doesn't name its book_id, so a query that went around the scope can't pass CI.
// It walks the whole query, subqueries included; joins are left alone (the composite keys keep them in the book). A whole raw query
// that reads a book table fails too, and so does a raw fragment that reads one without comparing a book_id. Never installed in
// production: the scope is the mechanism, this is the second check.
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

// A raw node as text: its references and sql.table() tables written out, values as `?`, queries in it as `(query)`.
function rawText(n: Node): string {
  const params = n.parameters as unknown[];
  return (n.sqlFragments as string[]).map((f, i) => f + (i < params.length ? inline(params[i]) : "")).join("");
}
function inline(p: unknown): string {
  if (!isNode(p)) return "?";
  if (p.kind === "RawNode") return rawText(p);
  if (p.kind === "TableNode") return tableName(p) ?? "?";
  if (p.kind === "ReferenceNode") {
    const column = isNode(p.column) ? (identifier(p.column.column) ?? "*") : "*";
    return p.table ? `${tableName(p.table)}.${column}` : column;
  }
  return p.kind.endsWith("QueryNode") ? "(query)" : "?";
}
const rawTables = (text: string) => [...text.matchAll(/\b(?:from|join|update|into)\s+(?:"?\w+"?\.)?"?(\w+)"?/gi)].map((m) => m[1]).filter(isBookTable);
const comparesBook = (text: string, name?: string) =>
  new RegExp(`(?:^|[^\\w.])${name ? `(?:${name}\\.)?` : "(?:\\w+\\.)?"}book_id\\s*(?:=|in\\b)`, "i").test(text);

// Whether a where clause compares `<name>.book_id` (= or in); `book_id is not null` doesn't keep a query in its book.
function namesBook(where: unknown, name: string): boolean {
  const ours = (n: unknown) => {
    if (!isNode(n) || n.kind !== "ReferenceNode") return false;
    const column = isNode(n.column) ? identifier(n.column.column) : undefined;
    return column === "book_id" && (n.table === undefined || tableName(n.table) === name);
  };
  for (const n of [where, ...walk(where)]) {
    if (!isNode(n)) continue;
    if (n.kind === "BinaryOperationNode" && ["=", "in"].includes((n.operator as Node).operator as string) && (ours(n.leftOperand) || ours(n.rightOperand)))
      return true;
    if (n.kind === "RawNode" && comparesBook(rawText(n), name)) return true;
  }
  return false;
}

function check(node: Node): void {
  const all = [node, ...walk(node)];
  const queries = all.filter((n) => ["SelectQueryNode", "UpdateQueryNode", "DeleteQueryNode"].includes(n.kind));
  for (const q of queries) {
    const roots = q.kind === "UpdateQueryNode" ? [q.table] : children((q.from as Node | undefined)?.froms);
    for (const r of roots.map(root)) if (r && isBookTable(r.table) && !namesBook(q.where, r.name)) throw new Error(`unscoped query on ${r.table}`);
  }
  // A whole query in raw SQL may read no book table. A raw fragment inside a query (a count, a recursive walk over places) may,
  // when it compares a book_id; the composite keys keep what it joins in that book.
  const inner = new Set(all.filter((n) => n.kind === "RawNode").flatMap((n) => (n.parameters as unknown[]).filter((p) => isNode(p) && p.kind === "RawNode")));
  for (const n of all) {
    if (n.kind !== "RawNode" || inner.has(n)) continue;
    const text = rawText(n);
    const [table] = rawTables(text);
    if (table && (n === node || !comparesBook(text))) throw new Error(`unscoped query on ${table}`);
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
