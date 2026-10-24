"use client";

import { Archive, Check, Ellipsis, Lock, LockOpen, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { copy } from "@/components/copy";

type Table = "facts" | "promises" | "exchanges" | "conversations";

// What can be done to one item, behind a "…" button: mark it done (a promise, an exchange or a gift idea) or outdated (a fact),
// which either user may; and edit its text, make it private or shared, or delete it, which only its recorder may (`mine`; the
// server checks again). Each goes to PATCH or DELETE /api/v1/items/{table}/{id}, then the page reloads its data.
// `field`: what "edit" changes (`text`, or `summary` for a conversation). `after`: where to go once it is deleted.
export function ItemActions({
  table,
  id,
  mine,
  visibility,
  text,
  field = "text",
  after,
}: {
  table: Table;
  id: string;
  mine: boolean;
  visibility: "shared" | "private";
  text: string;
  field?: "text" | "summary";
  after?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(method: "PATCH" | "DELETE", body?: object) {
    setBusy(true);
    setFailed(false);
    const res = await fetch(`/api/v1/items/${table}/${id}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setFailed(true);
    setOpen(false);
    setEditing(false);
    if (method === "DELETE" && after) router.push(after);
    else router.refresh();
  }

  if (editing)
    return (
      <form
        className="mt-2 flex w-full items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send("PATCH", { patch: { [field]: draft.trim() } });
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={copy.edit} autoFocus className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-2 py-1 text-sm" />
        <Action label={copy.save} disabled={busy} submit>
          <Check />
        </Action>
        <Action label={copy.cancel} onClick={() => setEditing(false)}>
          <X />
        </Action>
      </form>
    );

  const done = table === "promises" || table === "exchanges";
  // The partner's conversation: nothing either user may do to it, so no empty menu.
  if (!done && table !== "facts" && !mine) return null;
  return (
    <span className="relative ml-auto inline-flex shrink-0 items-center">
      {open && (
        <span className="mr-1 inline-flex items-center gap-0.5">
          {done && (
            <Action label={copy.done} disabled={busy} onClick={() => send("PATCH", { done: true })}>
              <Check />
            </Action>
          )}
          {table === "facts" && (
            <Action label={copy.outdated} disabled={busy} onClick={() => send("PATCH", { outdated: true })}>
              <Archive />
            </Action>
          )}
          {mine && (
            <>
              <Action label={copy.edit} onClick={() => setEditing(true)}>
                <Pencil />
              </Action>
              <Action
                label={visibility === "private" ? copy.makeShared : copy.makePrivate}
                disabled={busy}
                onClick={() => send("PATCH", { visibility: visibility === "private" ? "shared" : "private" })}
              >
                {visibility === "private" ? <LockOpen /> : <Lock />}
              </Action>
              <Action label={copy.remove} disabled={busy} onClick={() => confirm(copy.confirmRemove) && send("DELETE")}>
                <Trash2 />
              </Action>
            </>
          )}
        </span>
      )}
      <Action label={open ? copy.cancel : copy.actions} onClick={() => setOpen(!open)} expanded={open}>
        {open ? <X /> : <Ellipsis />}
      </Action>
      {failed && (
        <span role="alert" className="absolute top-full right-0 z-10 mt-1 rounded-md bg-surface px-2 py-1 text-xs whitespace-nowrap text-error shadow-card">
          {copy.actionFailed}
        </span>
      )}
    </span>
  );
}

function Action({ label, onClick, disabled, submit, expanded, children }: { label: string; onClick?: () => void; disabled?: boolean; submit?: boolean; expanded?: boolean; children: ReactNode }) {
  return (
    <button
      type={submit ? "submit" : "button"}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4"
    >
      {children}
    </button>
  );
}
