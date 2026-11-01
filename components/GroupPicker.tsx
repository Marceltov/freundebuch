"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/components/i18n";

// "+ Gruppe" on the friend page: a sheet with every group the viewer sees as a checkbox, and a field for a new one. A name that
// is already a group's name or other name ticks that group (the server resolves it). Each change goes to the groups API at once.
export function GroupPicker({
  personId,
  personName,
  groups,
  member,
  bookId,
}: {
  personId: string;
  personName: string;
  groups: { id: string; name: string }[];
  member: string[];
  /** The person's book: a group made here is made there, not in the user's oldest book. */
  bookId?: string;
}) {
  const copy = useCopy();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(groups);
  const [ticked, setTicked] = useState(new Set(member));
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);

  async function call(method: string, path: string, body?: object): Promise<Response | null> {
    setFailed(false);
    const res = await fetch(`/api/v1${path}${bookId ? `?book=${encodeURIComponent(bookId)}` : ""}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res?.ok) setFailed(true);
    return res?.ok ? res : null;
  }

  // Ticks at once and unticks again when the server refuses.
  async function toggle(id: string, on: boolean) {
    const set = (to: boolean) =>
      setTicked((t) => {
        const n = new Set(t);
        if (to) n.add(id);
        else n.delete(id);
        return n;
      });
    set(on);
    if (!(await call(on ? "PUT" : "DELETE", `/groups/${id}/members/${personId}`))) set(!on);
  }

  async function add() {
    const name = draft.trim();
    if (!name) return;
    const res = await call("POST", "/groups", { name });
    if (!res) return;
    const g: { id: string; name: string } = await res.json();
    if (!list.some((x) => x.id === g.id)) setList([...list, g].sort((a, b) => a.name.localeCompare(b.name, "de")));
    setDraft("");
    await toggle(g.id, true);
  }

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        aria-label={copy.editGroups}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted px-2.5 py-0.5 text-xs text-muted hover:text-ink"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        {copy.addGroup}
      </button>
      {open && (
        <div className="fixed inset-0 z-40" onKeyDown={(e) => e.key === "Escape" && close()}>
          <div className="absolute inset-0 bg-black/35" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={copy.groupsFor.replace("{name}", personName)}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[80dvh] max-w-2xl overflow-y-auto rounded-t-2xl bg-surface px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{copy.groupsFor.replace("{name}", personName)}</h2>
              <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-surface-2">
                {copy.close}
              </button>
            </div>
            <ul className="mt-2">
              {list.map((g) => (
                <li key={g.id} className="border-b border-rule">
                  <label className="flex items-center gap-3 py-2.5">
                    <input type="checkbox" checked={ticked.has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} className="h-5 w-5 accent-carbon" />
                    {g.name}
                  </label>
                </li>
              ))}
            </ul>
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={copy.newGroup}
                placeholder={copy.newGroupHint}
                className="w-full rounded-lg border border-rule bg-surface-2 px-3 py-2"
              />
            </form>
            {failed && (
              <p role="alert" className="mt-2 text-sm text-error">
                {copy.actionFailed}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
