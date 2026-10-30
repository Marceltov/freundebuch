"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AudioLines, Mic, Paperclip, SendHorizontal, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { canRecord, clearUnsent, unsent, useVoice } from "@/components/useVoice";
import type { ChatContext, ChatLink, PendingFile } from "@/backend";
import type { Copy } from "@/components/copy";
import { useCopy } from "@/components/i18n";
import { recentTurns } from "@/components/chatTurns";
import { shortDay } from "@/components/format";
import { sheetFit } from "@/components/sheetFit";
import { FilePreview } from "@/components/Pending";

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

const errors = (copy: Copy): Record<string, string> => ({
  chat_limit: copy.chatLimit,
  chat_unavailable: copy.chatUnavailable,
  chat_refused: copy.chatRefused,
  chat_too_long: copy.chatTooLong,
});

const noSubscribe = () => () => {};

const linkLabel = (copy: Copy, l: ChatLink) =>
  l.kind === "conversation" ? copy.conversationOn.replace("{day}", l.date ? shortDay(copy, l.date) : "") : (l.name ?? "");

// The chat with Claude ("Erzählen"), as a sheet over the current page. It knows the page it was opened on (a friend or a
// conversation) and says so in a chip the user can remove. The conversation is kept on this device; the server gets it whole
// with every message (backend/chat-route.ts). A failed message stays in the field to send again.
// With `sharing`, the paperclip hands files to POST /api/share, as sharing from the phone does, and they go along with this chat
// (context `fileIds`), to be worked through together. `files`: opened from Prüfen on those files, as a new conversation about them.
// With `voice` (a transcription server is set up), the microphone takes the place of send while the field is empty: a message
// spoken in is sent as its words (useVoice), like a voice message on WhatsApp.
export function ChatSheet({
  userId,
  sharing = false,
  voice = false,
  files = [],
  onClose,
}: {
  userId: string;
  sharing?: boolean;
  voice?: boolean;
  files?: string[];
  onClose: () => void;
}) {
  const copy = useCopy();
  const router = useRouter();
  const path = usePathname();
  // Opened on files from Prüfen, it is a conversation of its own about them.
  const own = files.length > 0;
  const [turns, setTurns] = useState<Turn[]>(() => (own ? [] : load(userId)));
  const [fileIds, setFileIds] = useState<string[]>(files);
  // The files and what a first read of each suggested, shown at the top, so there is something to answer to.
  const [shown, setShown] = useState<PendingFile[]>([]);
  const opened = fileIds.join();
  useEffect(() => {
    if (!opened) return;
    const ids = opened.split(",");
    fetch("/api/v1/files")
      .then((r) => (r.ok ? (r.json() as Promise<PendingFile[]>) : []))
      .then((fs) => setShown(ids.flatMap((id) => fs.filter((f) => f.id === id))))
      .catch(() => {});
  }, [opened]);
  // A message spoken before the last sheet was closed, whose words came back too late to send, waits in the field.
  const [draft, setDraft] = useState(() => (typeof window === "undefined" ? "" : (unsent() ?? "")));
  useEffect(clearUnsent, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<"sending" | "received" | "duplicate" | "failed" | "attached" | null>(null);
  // How many the last pick attached, for the message in the singular or the plural.
  const [attached, setAttached] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  // The name belongs to the person it was loaded for, so moving to another page never shows the one before.
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const personName = loaded && loaded.id === path.match(/^\/p\/([^/]+)$/)?.[1] ? loaded.name : null;
  const person = path.match(/^\/p\/([^/]+)$/)?.[1];
  const conversation = path.match(/^\/c\/([^/]+)$/)?.[1];
  const ramble = path.match(/^\/r\/([^/]+)$/)?.[1];
  // The page goes along at once; the chip shows the person's name once it has loaded.
  const about: { context: ChatContext; label: string } | null = dismissed
    ? null
    : fileIds.length
      ? { context: { fileIds }, label: fileIds.length === 1 ? copy.aboutFile : copy.aboutFiles.replace("{n}", String(fileIds.length)) }
      : person
        ? { context: { personId: person }, label: personName ? copy.aboutPerson.replace("{name}", personName) : copy.aboutThisPerson }
        : conversation
          ? { context: { conversationId: conversation }, label: copy.aboutConversation }
          : ramble
            ? { context: { rambleId: ramble }, label: copy.aboutRamble }
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

  // The field is one line to start with and grows with the text up to max-h-40; it follows the text however it changes, so
  // sending (which empties it) takes it back to one line.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // The keyboard starts in the field, and comes back to it once a reply is in.
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);

  // Where the browser doesn't shrink the page for the keyboard (Safari on iOS), the sheet follows the visible area itself.
  const [visible, setVisible] = useState<{ top: number; bottom: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => setVisible(sheetFit(window.innerHeight, vv));
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  // The page behind stays put while the sheet is open: iOS otherwise scrolls it under a drag, and the sheet with it.
  useEffect(() => {
    const y = window.scrollY;
    const body = document.body.style;
    const before = { position: body.position, top: body.top, width: body.width, overflow: body.overflow };
    Object.assign(body, { position: "fixed", top: `-${y}px`, width: "100%", overflow: "hidden" });
    return () => {
      Object.assign(body, before);
      window.scrollTo(0, y);
    };
  }, []);

  // With the keyboard up, iOS pans the whole screen under a drag (locking the page doesn't stop that), and the sheet goes
  // with it. So a drag inside the sheet is held unless it lands on something that can scroll that way (the messages, a long
  // draft): that scrolls, nothing else moves.
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = overlay.current;
    if (!root) return;
    let y = 0;
    const start = (e: TouchEvent) => {
      y = e.touches[0]?.clientY ?? 0;
    };
    const move = (e: TouchEvent) => {
      const box = (e.target as Element | null)?.closest?.<HTMLElement>("[data-scrolls]");
      const down = (e.touches[0]?.clientY ?? y) > y;
      const scrolls = box && box.scrollHeight > box.clientHeight && (down ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight);
      if (!scrolls && e.cancelable) e.preventDefault();
    };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
    };
  }, []);

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

  const recording = useVoice(
    (text) => send(text, true),
    (message) => setError(message),
  );
  // Known only in the browser; the server renders no microphone.
  const mic = useSyncExternalStore(
    noSubscribe,
    () => voice && canRecord(),
    () => false,
  );

  /** Sends the field, or `offered` (a suggestion tapped, or words spoken in); `spoken` words go into the field when sending fails. */
  async function send(offered?: string, spoken = false) {
    const text = (offered ?? draft).trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    // The message moves into the chat at once; the field is free while Claude works.
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(asked);
    if (!offered) setDraft("");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: recentTurns(asked).map(({ role, content, filed }) => ({ role, content, filed })), context: about?.context }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    const failed = !res || !body || "code" in body || !res.ok;
    const message = failed ? (body && errors(copy)[body.code]) || copy.chatUnavailable : null;
    // Nothing filed: the message goes back into the field to send again. Filed before the failure: say so, so it isn't sent twice.
    if (failed && !body?.filed) {
      setTurns(turns);
      if (!offered || spoken) setDraft(text);
      return setError(message);
    }
    const next: Turn[] = [
      ...asked,
      { role: "assistant", content: failed ? copy.filedThenFailed.replace("{error}", message!) : body.reply, links: body.links, filed: body.filed },
    ];
    setTurns(next);
    // A chat opened on files from Prüfen is its own: the chat kept on this device stays as it was.
    if (!own) save(userId, next);
    if (body.filed) router.refresh();
  }

  // What is picked goes along with this chat at once, all of it together; several carry one batch id, as from the phone.
  async function upload(picked: File[]) {
    if (!picked.length) return;
    setShot("sending");
    let result: "received" | "duplicate" | "failed" = "duplicate";
    const ids: string[] = [];
    const batch = picked.length > 1 ? `chat-${crypto.randomUUID()}` : null;
    for (const f of picked) {
      const form = new FormData();
      form.set("file", f, f.name);
      const res = await fetch("/api/share", { method: "POST", body: form, headers: batch ? { "x-freundebuch-batch": batch } : undefined }).catch(() => null);
      if (!res || res.status !== 202) {
        result = "failed";
        continue;
      }
      const body = (await res.json()) as { id: string; duplicate: boolean };
      ids.push(body.id);
      if (!body.duplicate && result !== "failed") result = "received";
    }
    if (ids.length && result !== "failed") {
      // Added to what the chat is about, not instead of it: a missing screenshot joins the others.
      setFileIds((before) => [...new Set([...before, ...ids])]);
      setDismissed(false);
      setAttached(ids.length);
      setShot("attached");
    } else setShot(result);
    router.refresh();
  }

  function reset() {
    setTurns([]);
    if (!own) save(userId, []);
    setError(null);
  }

  return (
    <div ref={overlay} className="fixed inset-0 z-40" onKeyDown={trap}>
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={copy.tell}
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[85dvh] max-w-2xl flex-col rounded-t-3xl bg-paper shadow-float"
        style={visible ? { top: visible.top, bottom: visible.bottom, height: "auto" } : undefined}
      >
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          <h2 className="flex-1 font-display text-2xl font-bold">{copy.tell}</h2>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-surface-2">
            <SquarePen aria-hidden className="h-4 w-4" />
            {copy.newChat}
          </button>
          <button
            type="button"
            aria-label={copy.closeChat}
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-2"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div data-scrolls className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-2">
          {about && (
            <span className="inline-flex items-center gap-1 self-center rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm text-muted">
              {about.label}
              <button
                type="button"
                aria-label={copy.removeContext}
                onClick={() => setDismissed(true)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-rule"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {shown.map((f) => (
            <div key={f.id} data-shown-file={f.id} className="flex gap-3 self-stretch rounded-2xl bg-surface p-3 shadow-card">
              <FilePreview item={f} />
              <div className="min-w-0 text-sm">
                <p className="text-muted">{copy.fileShared.replace("{day}", shortDay(copy, f.sharedOn))}</p>
                {f.summary && (
                  <p className={`mt-1 whitespace-pre-line ${shown.length > 1 ? "line-clamp-3" : ""}`}>
                    <b>{copy.fileSuggests}:</b> {f.summary}
                  </p>
                )}
              </div>
            </div>
          ))}
          {turns.length === 0 && !shown.length && <p className="mt-6 text-center text-muted">{copy.chatHello}</p>}
          {/* Opened on no page: one tap asks Claude to look back on the week's journal. */}
          {turns.length === 0 && !about && !busy && (
            <button
              type="button"
              onClick={() => send(copy.reflectOffer)}
              className="self-center rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-semibold text-carbon hover:bg-rule"
            >
              {copy.reflectOffer}
            </button>
          )}
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
                      <Link
                        key={l.url}
                        href={l.url}
                        onClick={onClose}
                        className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-carbon hover:bg-rule"
                      >
                        {linkLabel(copy, l)} ›
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            ),
          )}
          {/* A spoken message shows at once, while Whisper turns it into words. */}
          {recording.state === "transcribing" && (
            <p role="status" className="flex max-w-[85%] items-center gap-2 self-end rounded-2xl rounded-br-md bg-carbon/80 px-3.5 py-2.5 text-on-carbon">
              <AudioLines aria-hidden className="h-4 w-4 shrink-0 motion-safe:animate-pulse" />
              <span className="text-sm">{copy.voiceTranscribing}</span>
            </p>
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
        {shot && (
          <p
            role="status"
            className={`mx-4 flex flex-wrap items-center gap-x-2 rounded-xl bg-surface px-3 py-2 text-sm ${shot === "failed" ? "text-error" : ""}`}
          >
            {
              {
                sending: copy.shareReceiving,
                received: copy.shareReceived,
                duplicate: copy.shareDuplicate,
                failed: copy.shareFailed,
                attached: attached > 1 ? copy.filesAttached : copy.fileAttached,
              }[shot]
            }
            {shot === "received" && (
              <Link href="/pruefen" onClick={onClose} className="font-bold text-carbon">
                {copy.pending} ›
              </Link>
            )}
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
          {sharing && (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/*,application/pdf,text/plain,audio/*,.opus"
                multiple
                hidden
                onChange={(e) => {
                  upload([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label={copy.addImage}
                title={copy.addImage}
                disabled={shot === "sending"}
                onClick={() => picker.current?.click()}
                className="-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              >
                <Paperclip aria-hidden className="h-5 w-5" />
              </button>
            </>
          )}
          {recording.state === "recording" ? (
            <>
              <button
                type="button"
                aria-label={copy.voiceCancel}
                title={copy.voiceCancel}
                onClick={recording.cancel}
                className="-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Trash2 aria-hidden className="h-5 w-5" />
              </button>
              <p role="status" className="flex min-h-10 flex-1 items-center gap-2 py-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-error motion-safe:animate-pulse" />
                <span className="sr-only">{copy.voiceRecording}</span>
                <span className="tabular-nums">{`${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")}`}</span>
              </p>
              <button
                type="button"
                aria-label={copy.voiceSend}
                onClick={recording.send}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon"
              >
                <SendHorizontal aria-hidden className="h-5 w-5 translate-x-px -rotate-[25deg]" />
              </button>
            </>
          ) : (
            <>
              <textarea
                data-scrolls
                ref={field}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                onKeyDown={(e) => {
                  // Enter starts a new line, as on a phone it has to; Ctrl+Enter or ⌘+Enter sends from a keyboard.
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                enterKeyHint="enter"
                aria-label={copy.message}
                placeholder={copy.tellPlaceholder}
                rows={1}
                className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 leading-6 outline-none"
              />
              {mic && !draft.trim() ? (
                <button
                  type="button"
                  aria-label={recording.state === "transcribing" ? copy.voiceTranscribing : copy.voiceRecord}
                  title={recording.state === "transcribing" ? copy.voiceTranscribing : copy.voiceRecord}
                  disabled={busy || recording.state !== "idle"}
                  onClick={() => {
                    setError(null);
                    recording.start();
                  }}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon disabled:opacity-40"
                >
                  <Mic aria-hidden className={`h-5 w-5 ${recording.state === "transcribing" ? "motion-safe:animate-pulse" : ""}`} />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label={copy.send}
                  disabled={busy || !draft.trim()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carbon text-on-carbon disabled:opacity-40"
                >
                  <SendHorizontal aria-hidden className="h-5 w-5 translate-x-px -rotate-[25deg]" />
                </button>
              )}
            </>
          )}
        </form>
      </section>
    </div>
  );
}
