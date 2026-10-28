"use client";

import { Accessibility, Archive, BookOpen, CalendarClock, CalendarDays, Check, Ellipsis, Lock, LockOpen, Pencil, Smile, Sparkles, Trash2, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FactKind } from "@/backend";
import { copy } from "@/components/copy";

type Table = "facts" | "promises" | "exchanges" | "relationships" | "conversations";

// What can be done to one item, behind a "…" button that opens a small menu over the page, each action with its icon and its
// name: mark it done (a promise, an exchange or a gift idea) or outdated (a fact), which either user may; edit its text, change
// its date or delete it, which either of us may for a shared item (a conversation only its recorder); and make it private or
// shared, which only its recorder may (`mine`; the server checks again).
// Editing opens a sheet from the bottom, so the row or header it belongs to keeps its layout. Deleting asks once more in the
// menu itself. Each goes to PATCH or DELETE /api/v1/items/{table}/{id}, then the page reloads its data.
// `field`: what "edit" changes (`text`, `summary` for a conversation, `label` or `inverse` for a relationship: the other end's words). `after`: where to go once it is deleted. `date` (a
// conversation's day) adds "change the date", up to `today` (the server's, in the configured time zone). `kind`, on a fact,
// lets whoever may edit it move it to another kind (Gerade los, Gut zu wissen, Braucht, Wesen), and set the day to ask about a situation (`checkAfter`).

/** Whether the viewer may edit or delete the item: their own, or a shared one of the partner's that isn't a conversation. */
export function canEdit(table: Table, mine: boolean, visibility: "shared" | "private"): boolean {
  return mine || (table !== "conversations" && visibility === "shared");
}

// Every kind a fact can have, in menu order: a kind the backend adds doesn't compile until it has its entry here.
const KIND_ACTIONS: Record<FactKind, { label: string; icon: LucideIcon }> = {
  lasting: { label: copy.makeLasting, icon: BookOpen },
  situation: { label: copy.makeSituation, icon: Sparkles },
  need: { label: copy.makeNeed, icon: Accessibility },
  personality: { label: copy.makePersonality, icon: Smile },
};

/** The kind entries of a fact's menu, for whoever may edit it: every kind but its own. */
export function factKindActions(kind: FactKind | undefined, editable: boolean): Array<{ kind: FactKind; label: string }> {
  if (!editable || !kind) return [];
  return (Object.keys(KIND_ACTIONS) as FactKind[]).filter((k) => k !== kind).map((k) => ({ kind: k, label: KIND_ACTIONS[k].label }));
}

export function ItemActions({
  table,
  id,
  mine,
  visibility,
  text,
  field = "text",
  after,
  date,
  today,
  kind,
  checkAfter,
}: {
  table: Table;
  id: string;
  mine: boolean;
  visibility: "shared" | "private";
  text: string;
  field?: "text" | "summary" | "label" | "inverse";
  after?: string;
  date?: string;
  today?: string;
  kind?: FactKind;
  checkAfter?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<false | "text" | "date" | "ask">(false);
  const [draft, setDraft] = useState(text);
  const [day, setDay] = useState(date ?? "");
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
    close();
    setEditing(false);
    if (method === "DELETE" && after) router.push(after);
    else router.refresh();
  }

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  function edit(what: "text" | "date" | "ask") {
    close();
    setFailed(false);
    setDraft(text);
    setDay((what === "ask" ? checkAfter : date) ?? "");
    setEditing(what);
  }

  const done = table === "promises" || table === "exchanges";
  const title = editing === "date" ? copy.changeDate : editing === "ask" ? copy.askOnTitle : copy.edit;
  const editable = canEdit(table, mine, visibility);
  // The partner's conversation: nothing either user may do to it, so no empty menu.
  if (!done && table !== "facts" && !editable) return null;
  return (
    <span className="relative ml-auto inline-flex shrink-0">
      <button
        type="button"
        aria-label={copy.actions}
        aria-expanded={open}
        title={copy.actions}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Ellipsis aria-hidden className="h-5 w-5" />
      </button>

      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={close} />
          <span className="absolute top-full right-0 z-40 mt-1 flex w-52 flex-col rounded-2xl bg-surface p-1.5 text-[15px] shadow-float ring-1 ring-rule">
            {done && <Item icon={Check} label={copy.done} disabled={busy} onClick={() => send("PATCH", { done: true })} />}
            {table === "facts" && <Item icon={Archive} label={copy.outdated} disabled={busy} onClick={() => send("PATCH", { outdated: true })} />}
            {editable && (
              <>
                <Item icon={Pencil} label={copy.edit} onClick={() => edit("text")} />
                {factKindActions(kind, editable).map((a) => (
                  <Item
                    key={a.kind}
                    icon={KIND_ACTIONS[a.kind].icon}
                    label={a.label}
                    disabled={busy}
                    onClick={() => send("PATCH", { patch: { kind: a.kind } })}
                  />
                ))}
                {kind === "situation" && <Item icon={CalendarClock} label={copy.askOn} onClick={() => edit("ask")} />}
                {date && <Item icon={CalendarDays} label={copy.changeDate} onClick={() => edit("date")} />}
                {mine && (
                  <Item
                    icon={visibility === "private" ? LockOpen : Lock}
                    label={visibility === "private" ? copy.makeShared : copy.makePrivate}
                    disabled={busy}
                    onClick={() => send("PATCH", { visibility: visibility === "private" ? "shared" : "private" })}
                  />
                )}
                {confirming ? (
                  <Item icon={Trash2} label={copy.confirmRemove} danger disabled={busy} onClick={() => send("DELETE")} />
                ) : (
                  <Item icon={Trash2} label={copy.remove} danger onClick={() => setConfirming(true)} />
                )}
              </>
            )}
            {failed && (
              <span role="alert" className="px-3 py-1.5 text-sm text-error">
                {copy.actionFailed}
              </span>
            )}
          </span>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-40" onKeyDown={(e) => e.key === "Escape" && setEditing(false)}>
          <div className="absolute inset-0 bg-black/35" onClick={() => setEditing(false)} />
          <form
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onSubmit={(e) => {
              e.preventDefault();
              if (editing === "text" ? draft.trim() : day) send("PATCH", { patch: editing === "date" ? { date: day } : editing === "ask" ? { checkAfter: day } : { [field]: draft.trim() } });
            }}
            className="absolute inset-x-0 bottom-0 mx-auto max-w-2xl space-y-3 rounded-t-3xl bg-surface px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float"
          >
            <h2 className="font-display text-xl font-bold">{title}</h2>
            {editing !== "text" ? (
              <input
                type="date"
                value={day}
                max={editing === "date" ? today : undefined}
                onChange={(e) => setDay(e.target.value)}
                aria-label={title}
                autoFocus
                className="w-full rounded-xl border border-rule bg-paper px-3 py-2"
              />
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={copy.edit}
                autoFocus
                rows={field === "summary" ? 6 : 3}
                className="w-full resize-y rounded-xl border border-rule bg-paper px-3 py-2 leading-relaxed"
              />
            )}
            {failed && (
              <p role="alert" className="text-sm text-error">
                {copy.actionFailed}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-semibold hover:bg-surface-2">
                <X aria-hidden className="h-4 w-4" />
                {copy.cancel}
              </button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-2 font-bold text-on-carbon disabled:opacity-50">
                <Check aria-hidden className="h-4 w-4" />
                {copy.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </span>
  );
}

function Item({ icon: Icon, label, onClick, disabled, danger }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-40 ${danger ? "text-error" : ""}`}
    >
      <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
      {label}
    </button>
  );
}
