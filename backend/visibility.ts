// Item-level privacy in one place: a row is visible to a viewer when it is shared or they recorded it. Every read of a table that
// carries `visibility` and `recorded_by` goes through `visible`, so the rule cannot drift between call sites.
import { sql, type Expression, type SqlBool } from "kysely";
import type { Viewer } from "./types";

/** The tables whose rows carry a visibility and their recording user. */
export type VisibleTable = "conversations" | "facts" | "promises" | "dates" | "exchanges" | "relationships" | "group_members" | "journal_entries" | "rambles";

/** Narrows a query to the rows of `table` the viewer may see: `table.visibility = 'shared' or table.recorded_by = viewer`. */
export function visible<T extends { where(e: Expression<SqlBool>): T }>(qb: T, v: Viewer, table: VisibleTable): T {
  return qb.where(sql<SqlBool>`(${sql.ref(`${table}.visibility`)} = 'shared' or ${sql.ref(`${table}.recorded_by`)} = ${v.userId})`);
}

/**
 * Narrows a query on `groups` to the groups the viewer sees: a seeded one, one they made, or one with a membership they may see.
 * A group that only the partner's private memberships fill doesn't exist for the viewer: not its name, not its count.
 */
export function visibleGroups<T extends { where(e: Expression<SqlBool>): T }>(qb: T, v: Viewer): T {
  return qb.where(
    sql<SqlBool>`(groups.seeded = 1 or groups.created_by = ${v.userId} or exists (select 1 from group_members m where m.group_id = groups.id and (m.visibility = 'shared' or m.recorded_by = ${v.userId})))`,
  );
}
