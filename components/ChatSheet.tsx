"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SendHorizontal, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatContext, ChatLink } from "@/backend";
import { copy } from "@/components/copy";
import { recentTurns } from "@/components/chatTurns";
import { shortDay } from "@/components/format";

type Turn = { role: "user" | "assistant"; content: string; links?: ChatLink[]; filed?: boolean };

// One chat per signed-in user on this device: someone else signing in here never sees it. Storage can be blocked or throw
// (private windows, cleared site data); the chat then lasts only while the page is open.
const keyOf = (userId: string) => `freundebuch.chat.${userId}`;
const isTurn = (t: unknown): t is Turn =>
  !!t && typeof t === "object" && ((t as Turn).role === "user" || (t as Turn).role === "assistant") && typeof (t as Turn).content === "string";
const load = (userId: string): Turn[] => {
  try {
    localStorage.removeItem("freundebuch.chat"); // the shared key of the first version
    const t = JSON.parse(localStorage.getItem(keyOf(userId)) ?? "[]");
    return Array.isArray(t) ? t.filter(isTurn) : [];
  } catch {
    return [];
  }
};
const save = (userId: string, t: Turn[]) => {
  try {
    if (t.length) localStorage.setItem(keyOf(userId), JSON.stringify(t));
    else localStorage.removeItem(keyOf(userId));
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
export function ChatSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const [turns, setTurns] = useState<Turn[]>(() => load(userId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name belongs to the person it was loaded for, so moving to another page never shows the one before.
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const personName = loaded && loaded.id === path.match(/^\/p\/([^/]+)$/)?.[1] ? loaded.name : null;
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
      .then((p: { name: string } | null) => p && setLoaded({ id: person, name: p.name }))
      .catch(() => {});
  }, [person]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // The keyboard starts in the field, and comes back to it once a reply is in.
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);

  // Escape closes the sheet wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Tab and Shift+Tab go round inside the sheet while it is open.
  function trap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !sheet.current) return;
    const all = [...sheet.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea:not([disabled])")];
    if (!all.length) return;
    const [first, last] = [all[0], all[all.length - 1]];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    // The message moves into the chat at once; the field is free while Claude works.
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(asked);
    setDraft("");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: recentTurns(asked).map(({ role, content, filed }) => ({ role, content, filed })), context: about?.context }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    const failed = !res || !body || "code" in body || !res.ok;
    const message = failed ? (body && ERRORS[body.code]) || copy.chatUnavailable : null;
    // Nothing filed: the message goes back into the field to send again. Filed before the failure: say so, so it isn't sent twice.
    if (failed && !body?.filed) {
      setTurns(turns);
      setDraft(text);
      return setError(message);
    }
    const next: Turn[] = [...asked, { role: "assistant", content: failed ? copy.filedThenFailed.replace("{error}", message!) : body.reply, links: body.links, filed: body.filed }];
    setTurns(next);
    save(userId, next);
    if (body.filed) router.refresh();
  }

  function reset() {
    setTurns([]);
    save(userId, []);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-40" onKeyDown={trap}>
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <section
        ref={sheet}
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
          {busy && (
            <p role="status" className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-surface px-3.5 py-3 shadow-card">
              <span aria-hidden className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-2 w-2 rounded-full bg-carbon/70 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
              <span className="text-sm text-muted">{copy.thinking}</span>
            </p>
          )}
          <div ref={end} />
        </div>

        {error && (
          <p role="alert" className="mx-4 rounded-xl bg-surface px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        <form
          className="m-3 flex items-end gap-2 rounded-3xl border-2 border-rule bg-surface py-1.5 pr-1.5 pl-4 focus-within:border-carbon"
          style={{ marginBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={field}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // One line to start with, growing with the text up to max-h-40.
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            aria-label={copy.message}
            placeholder={copy.tellPlaceholder}
            rows={1}
            className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 leading-6 outline-none"
          />
          <button type="submit" aria-label={copy.send} disabled={busy || !draft.trim()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon disabled:opacity-40">
            <SendHorizontal aria-hidden className="h-5 w-5 translate-x-px -rotate-[25deg]" />
          </button>
        </form>
      </section>
    </div>
  );
}
