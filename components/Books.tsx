"use client";

import { BookOpen, Crown, Plus, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/backend";
import { CopyField } from "@/components/CopyButton";
import { useCopy } from "@/components/i18n";
import type { Copy } from "@/components/copy";
import { shortDay } from "@/components/format";

export type BookRow = { id: string; name: string; role: Role; members: { id: string; name: string; role: Role }[] };
type Member = BookRow["members"][number];
type Invitation = { id: string; role: "member" | "admin"; createdBy: string; expiresAt: number };

/** What the viewer may do with a book, by their role in it; `books`: how many books they have. The server checks again. */
export function bookActions(b: BookRow, books: number) {
  const manages = b.role === "owner" || b.role === "admin";
  return { rename: manages, invite: manages, inviteAdmin: b.role === "owner", leave: b.role !== "owner" && books > 1, delete: b.role === "owner" && books > 1 };
}

/** What the viewer (`me`, a user id) may do about another member of the book. */
export function memberActions(b: BookRow, me: string, m: Member) {
  if (m.id === me) return { remove: false, role: false, handOver: false };
  const owner = b.role === "owner";
  return { remove: owner ? m.role !== "owner" : b.role === "admin" && m.role === "member", role: owner, handOver: owner };
}

/** What a failed action shows: the copy for a role that doesn't allow it, a book that is gone, else that it didn't work. */
export function failureText(copy: Copy, status: number | null): string {
  return status === 403 ? copy.notYourRole : status === 404 ? copy.bookGone : copy.actionFailed;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Einstellungen → Bücher: each of the viewer's books with its members and their roles, its open invitations, and what the
// viewer's role there allows (backend/people/manage.ts and invitations.ts check it again). Destructive steps ask first.
export function Books({ books, invitations, me }: { books: BookRow[]; invitations: Record<string, Invitation[]>; me: string }) {
  const copy = useCopy();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ book: string; url: string } | null>(null);
  const [name, setName] = useState("");

  async function call(method: string, path: string, body?: unknown): Promise<Response | null> {
    const res = await fetch(`/api/v1${path}`, {
      method,
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(failureText(copy, res?.status ?? null));
      return null;
    }
    setError(null);
    return res;
  }
  const done = (res: Response | null) => res && router.refresh();
  const ask = (text: string) => window.confirm(text);

  async function invite(b: BookRow, role: "member" | "admin") {
    const res = await call("POST", `/books/${b.id}/invitations`, { role });
    if (!res) return;
    const { url } = (await res.json()) as { url: string };
    setMade({ book: b.id, url: new URL(url, window.location.origin).toString() });
    router.refresh();
  }

  async function rename(b: BookRow) {
    const next = window.prompt(copy.newBookName, b.name)?.trim();
    if (next && next !== b.name) done(await call("PATCH", `/books/${b.id}`, { name: next }));
  }

  const button = "inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-rule";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{copy.booksHint}</p>
      {books.map((b) => {
        const can = bookActions(b, books.length);
        const open = invitations[b.id] ?? [];
        return (
          <section key={b.id} aria-label={b.name} className="rounded-2xl border border-rule p-3">
            <h3 className="flex items-center gap-2 font-display font-semibold">
              <BookOpen aria-hidden className="h-4 w-4" />
              {b.name}
              <span className="text-xs font-normal text-muted">{copy.roleName[b.role]}</span>
            </h3>
            <ul className="mt-2 space-y-1">
              {b.members.map((m) => {
                const may = memberActions(b, me, m);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {m.name}
                      {m.id === me && ` (${copy.you})`} <span className="text-muted">· {copy.roleName[m.role]}</span>
                    </span>
                    {may.role && m.role !== "owner" && (
                      <button
                        type="button"
                        className={button}
                        onClick={async () => done(await call("PATCH", `/books/${b.id}/members/${m.id}`, { role: m.role === "admin" ? "member" : "admin" }))}
                      >
                        {m.role === "admin" ? copy.makeMember : copy.makeAdmin}
                      </button>
                    )}
                    {may.handOver && (
                      <button
                        type="button"
                        className={button}
                        onClick={async () =>
                          ask(copy.confirmHandOver.replace("{book}", b.name).replace("{name}", m.name)) &&
                          done(await call("POST", `/books/${b.id}/owner`, { userId: m.id }))
                        }
                      >
                        <Crown aria-hidden className="h-3.5 w-3.5" />
                        {copy.handOver}
                      </button>
                    )}
                    {may.remove && (
                      <button
                        type="button"
                        className={button}
                        onClick={async () =>
                          ask(copy.confirmRemoveMember.replace("{book}", b.name).replaceAll("{name}", m.name)) &&
                          done(await call("DELETE", `/books/${b.id}/members/${m.id}`))
                        }
                      >
                        <UserMinus aria-hidden className="h-3.5 w-3.5" />
                        {copy.removeMember}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {can.invite && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={button} onClick={() => invite(b, "member")}>
                    {copy.invite} {copy.asMember}
                  </button>
                  {can.inviteAdmin && (
                    <button type="button" className={button} onClick={() => invite(b, "admin")}>
                      {copy.invite} {copy.asAdmin}
                    </button>
                  )}
                </div>
                {made?.book === b.id && (
                  <div>
                    <CopyField label={copy.invite} text={made.url} shown />
                    <p className="mt-1 text-xs text-muted">{copy.invitationHint}</p>
                  </div>
                )}
                {open.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold">{copy.openInvitations}</p>
                    <ul className="space-y-1">
                      {open.map((inv) => (
                        <li key={inv.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 text-muted">
                            {copy.openInvitationLine
                              .replace("{role}", copy.roleName[inv.role])
                              .replace("{name}", inv.createdBy)
                              .replace("{day}", shortDay(copy, day(inv.expiresAt)))}
                          </span>
                          <button type="button" className={button} onClick={async () => done(await call("DELETE", `/books/${b.id}/invitations/${inv.id}`))}>
                            {copy.revoke}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {can.rename && (
                <button type="button" className={button} onClick={() => rename(b)}>
                  {copy.rename}
                </button>
              )}
              {can.leave && (
                <button
                  type="button"
                  className={button}
                  onClick={async () => ask(copy.confirmLeave.replace("{book}", b.name)) && done(await call("POST", `/books/${b.id}/leave`))}
                >
                  {copy.leave}
                </button>
              )}
              {can.delete && (
                <button
                  type="button"
                  className={button}
                  onClick={async () => ask(copy.confirmDelete.replace("{book}", b.name)) && done(await call("DELETE", `/books/${b.id}`))}
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  {copy.deleteBook}
                </button>
              )}
            </div>
          </section>
        );
      })}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const res = await call("POST", "/books", { name: name.trim() });
          if (res) {
            setName("");
            router.refresh();
          }
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={copy.newBookName}
          placeholder={copy.newBook}
          className="min-w-0 flex-1 rounded-xl border-2 border-rule bg-surface px-3 py-1.5 text-sm outline-none focus:border-carbon"
        />
        <button type="submit" className={button}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {copy.create}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
