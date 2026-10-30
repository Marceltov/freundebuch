"use client";

import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Look, LookPart, LookParts } from "@/backend";
import { Avatar } from "@/components/Avatar";
import { copy } from "@/components/copy";

const GENDERS: { value: "female" | "male" | "nonbinary" | null; label: string }[] = [
  { value: "female", label: copy.genderF },
  { value: "male", label: copy.genderM },
  { value: "nonbinary", label: copy.genderX },
  { value: null, label: copy.genderNone },
];

const INTERVALS: { days: number | null; label: string }[] = [
  { days: 14, label: copy.twoWeeks },
  { days: 30, label: copy.month },
  { days: 90, label: copy.quarter },
  { days: null, label: copy.never },
];

// The round "…" on a friend's page: a sheet with what only Claude could do before. How often to see them, a new name, their
// gender (which the role labels follow), how they look (the parts of their avatar), a nickname that finds them too, and merging a duplicate into them. Each change closes the sheet and reloads the page.
export function PersonMenu({
  id,
  name,
  gender = null,
  look = null,
  intervalDays,
  others,
}: {
  id: string;
  name: string;
  gender?: "female" | "male" | "nonbinary" | null;
  look?: Look | null;
  intervalDays: number | null;
  others: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [alias, setAlias] = useState("");
  const [drop, setDrop] = useState("");
  const [failed, setFailed] = useState(false);
  const label = copy.moreAbout.replace("{name}", name);

  // `stay`: keep the sheet open, to change several parts of a look one after another.
  async function send(method: string, path: string, body: object, stay = false) {
    setFailed(false);
    const res = await fetch(`/api/v1/people/${id}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    if (!stay) setOpen(false);
    setAlias("");
    setDrop("");
    router.refresh();
  }

  const dropName = others.find((o) => o.id === drop)?.name ?? "";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          setNewName(name);
          setOpen(true);
        }}
        className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule"
      >
        <Ellipsis aria-hidden className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="absolute inset-0 bg-black/35" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] max-w-2xl space-y-5 overflow-y-auto rounded-t-3xl bg-surface px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold">{name}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-surface-2">
                {copy.close}
              </button>
            </div>

            <Part title={copy.howOften}>
              <div role="radiogroup" aria-label={copy.howOften} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
                {INTERVALS.map((i) => (
                  <label key={i.label} className="cursor-pointer">
                    <input
                      type="radio"
                      name="interval"
                      className="peer sr-only"
                      checked={intervalDays === i.days}
                      onChange={() => send("PUT", "/interval", { days: i.days, confirmed: true })}
                    />
                    <span className="block rounded-xl py-2 text-center text-sm peer-checked:bg-carbon peer-checked:font-bold peer-checked:text-on-carbon peer-focus-visible:outline-2 peer-focus-visible:outline-carbon">
                      {i.label}
                    </span>
                  </label>
                ))}
              </div>
            </Part>

            <Part title={copy.rename}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newName.trim() && newName.trim() !== name) send("PATCH", "", { name: newName.trim() });
                }}
              >
                <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={copy.groupName} className="w-full rounded-xl border border-rule bg-paper px-3 py-2" />
              </form>
            </Part>

            <Part title={copy.gender}>
              <div role="radiogroup" aria-label={copy.gender} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
                {GENDERS.map((g) => (
                  <label key={g.label} className="cursor-pointer">
                    <input type="radio" name="gender" className="peer sr-only" checked={gender === g.value} onChange={() => send("PATCH", "", { gender: g.value })} />
                    <span className="block rounded-xl py-2 text-center text-sm peer-checked:bg-carbon peer-checked:font-bold peer-checked:text-on-carbon peer-focus-visible:outline-2 peer-focus-visible:outline-carbon">
                      {g.label}
                    </span>
                  </label>
                ))}
              </div>
            </Part>

            <Part title={copy.look} hint={copy.lookHint}>
              <LookEditor look={look} onChange={(next) => send("PATCH", "", { look: next }, true)} />
            </Part>

            <Part title={copy.addNickname} hint={copy.nicknameHint}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (alias.trim()) send("POST", "/aliases", { alias: alias.trim() });
                }}
              >
                <input value={alias} onChange={(e) => setAlias(e.target.value)} aria-label={copy.nickname} className="w-full rounded-xl border border-rule bg-paper px-3 py-2" />
              </form>
            </Part>

            {others.length > 0 && (
              <Part title={copy.mergeDuplicate} hint={copy.mergeDuplicateHint}>
                <select value={drop} onChange={(e) => setDrop(e.target.value)} aria-label={copy.samePerson} className="w-full rounded-xl border border-rule bg-paper px-3 py-2">
                  <option value="">{copy.samePerson}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {drop && (
                  <button type="button" onClick={() => send("POST", "/merge", { drop })} className="mt-2 w-full rounded-xl bg-carbon px-3 py-2 font-bold text-on-carbon">
                    {copy.confirmMergePerson.replace("{drop}", dropName).replace("{keep}", name)}
                  </button>
                )}
              </Part>
            )}

            {failed && (
              <p role="alert" className="text-sm text-error">
                {copy.actionFailed}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Part({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {hint && <p className="mb-1.5 text-sm text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-1.5"}>{children}</div>
    </section>
  );
}

// What a look put together by hand starts from.
const START: LookParts = { face: "oval", skin: "medium", hair: "short", hairColor: "brown", glasses: "none", beard: "none" };
const PARTS = Object.keys(copy.lookValue) as LookPart[];

// One select per part beside the avatar; every change is saved at once. The user's words for the look stay with it.
function LookEditor({ look: saved, onChange }: { look: Look | null; onChange: (look: Look | null) => void }) {
  // Shown at once; the page reloads with the saved look behind it.
  const [look, setLook] = useState(saved);
  const change = (next: Look | null) => {
    setLook(next);
    onChange(next);
  };
  if (!look) {
    return (
      <button type="button" onClick={() => change({ ...START, description: null })} className="w-full rounded-xl bg-surface-2 px-3 py-2 font-semibold hover:bg-rule">
        {copy.lookStart}
      </button>
    );
  }
  const parts: LookParts = { face: look.face, skin: look.skin, hair: look.hair, hairColor: look.hairColor, glasses: look.glasses, beard: look.beard };
  return (
    <div className="space-y-2">
      {look.description && <p className="text-sm text-muted italic">{copy.lookDescribed.replace("{description}", look.description)}</p>}
      <div className="flex items-start gap-3">
        <span className="shrink-0 overflow-hidden rounded-full bg-surface-2">
          <Avatar look={parts} size={88} />
        </span>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {PARTS.map((part) => (
            <label key={part} className="text-sm">
              <span className="block text-muted">{copy.lookPart[part]}</span>
              <select
                value={look[part]}
                onChange={(e) => change({ ...look, [part]: e.target.value })}
                className="w-full rounded-xl border border-rule bg-paper px-2 py-1.5"
              >
                {Object.entries(copy.lookValue[part]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => change(null)} className="text-sm font-semibold text-muted underline">
        {copy.lookClear}
      </button>
    </div>
  );
}
