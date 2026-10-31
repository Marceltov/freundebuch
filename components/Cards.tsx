"use client";

import { Link2, Mail, MapPin, Phone, Plus, Save, Trash2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Card, OwnCard, PersonCard } from "@/backend";
import { CopyField } from "@/components/CopyButton";
import { useCopy } from "@/components/i18n";

// Own cards (backend/sharing/cards.ts, ADR 0024): what a person says about themselves, the only thing that crosses between people.

const FIELDS = ["name", "phone", "email", "address", "birthday", "note"] as const;
const button = "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-bold";
const input = "w-full rounded-xl border border-rule bg-paper px-3 py-2";

/** Settings: the viewer's own cards (GET/PUT/DELETE /api/v1/me/cards/{label}), each with its own secret link, and a new one. */
export function OwnCardsSettings({ cards }: { cards: OwnCard[] }) {
  const copy = useCopy();
  const router = useRouter();
  const [label, setLabel] = useState(cards.length ? "" : copy.cardDefaultLabel);
  const [failed, setFailed] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/v1/me/cards/${encodeURIComponent(label.trim())}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) {
      setLabel("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">{copy.ownCardHint}</p>
      {cards.map((c) => (
        <OwnCardEditor key={c.label} {...c} />
      ))}
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block font-semibold">{copy.cardNewLabel}</span>
          <input required maxLength={50} value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
        </label>
        <button type="submit" className={`${button} bg-carbon text-on-carbon`}>
          <Plus aria-hidden className="h-4 w-4" />
          {copy.cardCreate}
        </button>
      </form>
      {failed && (
        <p role="status" className="text-error">
          {copy.actionFailed}
        </p>
      )}
    </div>
  );
}

/** One of the viewer's cards: its fields, its link (shown once), and deleting it. */
function OwnCardEditor({ label, card: initial, published: wasPublished }: OwnCard) {
  const copy = useCopy();
  const router = useRouter();
  const [card, setCard] = useState<Card>(initial);
  const [published, setPublished] = useState(wasPublished);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"saved" | "failed" | null>(null);
  const path = `/api/v1/me/cards/${encodeURIComponent(label)}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(card) }).catch(() => null);
    setState(res?.ok ? "saved" : "failed");
  }
  async function publish() {
    const res = await fetch(`${path}/link`, { method: "POST" }).catch(() => null);
    setState(res?.ok ? null : "failed");
    if (res?.ok) {
      setUrl(((await res.json()) as { url: string }).url);
      setPublished(true);
    }
  }
  async function unpublish() {
    const res = await fetch(`${path}/link`, { method: "DELETE" }).catch(() => null);
    setState(res?.ok ? null : "failed");
    if (res?.ok) {
      setUrl(null);
      setPublished(false);
    }
  }
  async function remove() {
    if (!window.confirm(copy.cardDeleteConfirm.replace("{label}", label))) return;
    const res = await fetch(path, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setState("failed");
    router.refresh();
  }

  return (
    <section aria-label={label} className="space-y-3 rounded-xl border border-rule p-3">
      <h3 className="font-display font-semibold">{label}</h3>
      <form onSubmit={save} className="space-y-2">
        {FIELDS.map((f) => (
          <label key={f} className="block">
            <span className="mb-1 block font-semibold">{copy.cardFields[f]}</span>
            {f === "address" || f === "note" ? (
              <textarea rows={2} value={card[f] ?? ""} onChange={(e) => setCard({ ...card, [f]: e.target.value })} className={input} />
            ) : (
              <input
                type={f === "email" ? "email" : f === "phone" ? "tel" : f === "birthday" ? "date" : "text"}
                value={card[f] ?? ""}
                onChange={(e) => setCard({ ...card, [f]: e.target.value })}
                className={input}
              />
            )}
          </label>
        ))}
        <button type="submit" className={`${button} bg-carbon text-on-carbon`}>
          <Save aria-hidden className="h-4 w-4" />
          {copy.save}
        </button>
        {state === "saved" && <span className="ml-2 text-muted">{copy.saved}</span>}
      </form>
      {url && (
        <>
          <CopyField label={copy.cardLink} text={url} />
          <p className="text-muted">{copy.cardLinkOnce}</p>
        </>
      )}
      {!url && published && <p className="text-muted">{copy.cardPublished}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={publish} className={`${button} bg-carbon text-on-carbon`}>
          <Link2 aria-hidden className="h-4 w-4" />
          {published ? copy.cardLinkReplace : copy.cardLinkNew}
        </button>
        {published && (
          <button type="button" onClick={unpublish} className={`${button} bg-surface-2`}>
            <Unlink aria-hidden className="h-4 w-4" />
            {copy.cardLinkRevoke}
          </button>
        )}
        <button type="button" onClick={remove} className={`${button} bg-surface-2`}>
          <Trash2 aria-hidden className="h-4 w-4" />
          {copy.cardDelete}
        </button>
        {state === "failed" && (
          <span role="status" className="text-error">
            {copy.actionFailed}
          </span>
        )}
      </div>
    </section>
  );
}

/** A friend's page, once their card is attached (in the person's menu): what it says, and removing it (DELETE /api/v1/people/{id}/card). */
export function PersonCardBox({ personId, card }: { personId: string; card: PersonCard }) {
  const copy = useCopy();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  async function unsubscribe() {
    const res = await fetch(`/api/v1/people/${personId}/card`, { method: "DELETE" }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) router.refresh();
  }

  const c = card.card;
  return (
    <div className="space-y-2 text-sm">
      {c && (
        <ul className="space-y-1">
          {c.phone && (
            <li className="flex items-center gap-2">
              <Phone aria-hidden className="h-4 w-4 text-muted" />
              <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-carbon">
                {c.phone}
              </a>
            </li>
          )}
          {c.email && (
            <li className="flex items-center gap-2">
              <Mail aria-hidden className="h-4 w-4 text-muted" />
              <a href={`mailto:${c.email}`} className="font-semibold text-carbon">
                {c.email}
              </a>
            </li>
          )}
          {c.address && (
            <li className="flex items-center gap-2 whitespace-pre-line">
              <MapPin aria-hidden className="h-4 w-4 shrink-0 text-muted" />
              {c.address}
            </li>
          )}
          {c.birthday && <li className="text-muted">{copy.cardBirthday.replace("{date}", c.birthday)}</li>}
          {c.note && <li className="whitespace-pre-line text-muted">{c.note}</li>}
        </ul>
      )}
      <p className="text-xs text-muted">{card.failed ? copy.cardFailed[card.failed] : copy.cardOwnWords}</p>
      <button type="button" onClick={unsubscribe} className="text-xs font-semibold text-muted underline">
        {copy.cardUnsubscribe}
      </button>
      {failed && (
        <p role="status" className="text-error">
          {copy.actionFailed}
        </p>
      )}
    </div>
  );
}
