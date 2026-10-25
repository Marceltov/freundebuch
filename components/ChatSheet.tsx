"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SendHorizontal, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatContext, ChatLink } from "@/backend";
import { copy } from "@/components/copy";
import { shortDay } from "@/components/format";

type Turn = { role: "user" | "assistant"; content: string; links?: ChatLink[] };

const KEY = "freundebuch.chat";
// Storage can be blocked or throw (private windows, cleared site data); the chat then lasts only while the page is open.
const load = (): Turn[] => {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
};
const save = (t: Turn[]) => {
  try {
    if (t.length) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {}
};

const ERRORS: Record<string, string> = {
  chat_limit: copy.chatLimit,
  chat_unavailable: copy.chatUnavailable,
  chat_refused: copy.chatRefused,
  chat_too_long: copy.chatTooLong,
};

const linkLabel = (l: ChatLink) => (l.kind === "conversation" ? copy.conversationOn.replace("{day}", l.date ? shortDay(l.date) : "") : (l.name ?? ""));

// The chat with Claude ("Erzählen"), as a sheet over the current page. It knows the page it was opened on (a friend or a
// conversation) and says so in a chip the user can remove. The conversation is kept on this device; the server gets it whole
// with every message (backend/chat-route.ts). A failed message stays in the field to send again.
export function ChatSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const [turns, setTurns] = useState<Turn[]>(load);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personName, setPersonName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const person = path.match(/^\/p\/([^/]+)$/)?.[1];
  const conversation = path.match(/^\/c\/([^/]+)$/)?.[1];
  // The page goes along at once; the chip shows the person's name once it has loaded.
  const about: { context: ChatContext; label: string } | null = dismissed
    ? null
    : person
      ? { context: { personId: person }, label: personName ? copy.aboutPerson.replace("{name}", personName) : copy.aboutThisPerson }
      : conversation
        ? { context: { conversationId: conversation }, label: copy.aboutConversation }
        : null;

  useEffect(() => {
    if (!person) return;
    fetch(`/api/v1/people/${person}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { name: string } | null) => p && setPersonName(p.name))
      .catch(() => {});
  }, [person]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: asked.map(({ role, content }) => ({ role, content })), context: about?.context }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !body || "code" in body || !res.ok) return setError((body && ERRORS[body.code]) || copy.chatUnavailable);
    const next: Turn[] = [...asked, { role: "assistant", content: body.reply, links: body.links }];
    setTurns(next);
    save(next);
    setDraft("");
    if (body.filed) router.refresh();
  }

  function reset() {
    setTurns([]);
    save([]);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-40" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.tell}
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[85dvh] max-w-2xl flex-col rounded-t-3xl bg-paper shadow-float"
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h2 className="flex-1 font-display text-2xl font-bold">{copy.tell}</h2>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-surface-2">
            <SquarePen aria-hidden className="h-4 w-4" />
            {copy.newChat}
          </button>
          <button type="button" aria-label={copy.closeChat} onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2">
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-2">
          {about && (
            <span className="inline-flex items-center gap-1 self-center rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm text-muted">
              {about.label}
              <button type="button" aria-label={copy.removeContext} onClick={() => setDismissed(true)} className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-rule">
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {turns.length === 0 && <p className="mt-6 text-center text-muted">{copy.chatHello}</p>}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-carbon px-3.5 py-2.5 whitespace-pre-wrap text-on-carbon">
                {t.content}
              </p>
            ) : (
              <div key={i} className="flex max-w-[85%] flex-col items-start gap-1.5 self-start">
                <p className="rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 whitespace-pre-wrap shadow-card">{t.content}</p>
                {t.links && t.links.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {t.links.map((l) => (
                      <Link key={l.url} href={l.url} onClick={onClose} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-carbon hover:bg-rule">
                        {linkLabel(l)} ›
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            ),
          )}
          {busy && <p className="self-start text-sm text-muted">{copy.thinking}</p>}
          <div ref={end} />
        </div>

        {error && (
          <p role="alert" className="mx-4 rounded-xl bg-surface px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        <form
          className="m-3 flex items-end gap-2 rounded-3xl border-2 border-rule bg-surface p-1.5 pl-4 focus-within:border-carbon"
          style={{ marginBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            aria-label={copy.message}
            placeholder={copy.tellPlaceholder}
            rows={2}
            disabled={busy}
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 outline-none"
          />
          <button type="submit" aria-label={copy.send} disabled={busy || !draft.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon disabled:opacity-40">
            <SendHorizontal aria-hidden className="h-5 w-5" />
          </button>
        </form>
      </section>
    </div>
  );
}
