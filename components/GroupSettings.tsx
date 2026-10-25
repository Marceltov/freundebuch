"use client";

import { Merge, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "@/components/copy";

type Group = { id: string; name: string; aliases: string[]; count: number };

// Settings, "Gruppen": one card per group with its other names. Rename (the old name stays as another name), add or drop other
// names, merge another group into this one, delete it for the viewer. Each change goes to the groups API, then the page reloads.
// A refusal (400) shows what it means for that action in German; anything else the general failure.
export function GroupSettings({ groups }: { groups: Group[] }) {
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <GroupCard key={g.id} g={g} others={groups.filter((o) => o.id !== g.id)} />
      ))}
    </ul>
  );
}

function GroupCard({ g, others }: { g: Group; others: Group[] }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(g.name);
  const [alias, setAlias] = useState("");
  const [drop, setDrop] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: string, path: string, body?: object, refused = copy.actionFailed): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/v1/groups/${g.id}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 400 ? refused : copy.actionFailed);
      return false;
    }
    router.refresh();
    return true;
  }

  const count = g.count === 1 ? copy.onePerson : copy.people.replace("{n}", String(g.count));
  return (
    <li role="group" aria-label={g.name} className="rounded-xl bg-surface-2/60 p-3">
      <div className="flex items-center gap-2">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim() && (await send("PATCH", "", { name: name.trim() }, copy.groupNameTaken))) setRenaming(false);
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={copy.groupName} autoFocus className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-2 py-1" />
          </form>
        ) : (
          <span className="min-w-0 flex-1 font-semibold">{g.name}</span>
        )}
        <span className="text-xs text-muted tabular-nums">{count}</span>
        <IconButton label={copy.rename} onClick={() => setRenaming(!renaming)}>
          <Pencil />
        </IconButton>
        {confirming ? (
          <button type="button" onClick={() => send("DELETE", "")} className="rounded-full bg-error px-2.5 py-1 text-xs font-semibold text-white">
            {copy.confirmRemove}
          </button>
        ) : (
          <IconButton label={copy.remove} onClick={() => setConfirming(true)}>
            <Trash2 />
          </IconButton>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {g.aliases.map((a) => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full border border-rule px-2 py-0.5 text-xs">
            {a}
            <button type="button" aria-label={copy.removeOtherName.replace("{name}", a)} onClick={() => send("DELETE", `/aliases/${encodeURIComponent(a)}`)} className="text-muted hover:text-ink">
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (alias.trim() && (await send("POST", "/aliases", { alias: alias.trim() }, copy.groupNameTaken))) setAlias("");
          }}
        >
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            aria-label={copy.otherName}
            placeholder={`+ ${copy.otherName}`}
            className="w-36 rounded-full border border-dashed border-muted bg-transparent px-2 py-0.5 text-xs"
          />
        </form>
      </div>

      {others.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={drop}
            onChange={(e) => {
              setDrop(e.target.value);
              setConfirmingMerge(false);
            }}
            aria-label={copy.mergeInto} className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-2 py-1 text-sm">
            <option value="">{copy.mergeInto}</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {confirmingMerge ? (
            <button
              type="button"
              onClick={async () => {
                if (await send("POST", "/merge", { drop }, copy.mergeRefused)) setDrop("");
                setConfirmingMerge(false);
              }}
              className="rounded-full bg-carbon px-3 py-1 text-sm font-semibold text-on-carbon"
            >
              {copy.confirmMerge.replace("{drop}", others.find((o) => o.id === drop)?.name ?? "").replace("{keep}", g.name)}
            </button>
          ) : (
            <button
              type="button"
              disabled={!drop}
              onClick={() => setConfirmingMerge(true)}
              className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-sm disabled:opacity-40"
            >
              <Merge aria-hidden className="h-4 w-4" />
              {copy.merge}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </li>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink [&>svg]:h-4 [&>svg]:w-4"
    >
      {children}
    </button>
  );
}
