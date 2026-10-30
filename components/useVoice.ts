"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/components/copy";

export type VoiceState = "idle" | "recording" | "transcribing";

// What the browser records in: Opus in WebM (Chrome, Firefox, Android), AAC in MP4 (Safari, iPhone).
const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
const typeOf = () => (typeof MediaRecorder === "undefined" ? undefined : TYPES.find((t) => MediaRecorder.isTypeSupported(t)));

/** Whether this browser can record a message at all. */
export const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

// A message spoken into Erzählen, as on WhatsApp: start records, send hands the recording to POST /api/chat/voice, which turns
// it into its words with the household's own Whisper; `onText` gets them, to send as the user's message. Cancel throws the
// recording away. The recording stays in this tab's memory only and is never stored anywhere.
export function useVoice(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  // The handlers of the latest render: a recording ends after the chat may have moved on.
  const handlers = useRef({ onText, onError });
  useEffect(() => {
    handlers.current = { onText, onError };
  });

  // A sheet closed while recording throws the recording away and lets go of the microphone.
  useEffect(
    () => () => {
      keep.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );

  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(tick);
  }, [state]);

  async function start() {
    if (state !== "idle") return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(copy.voiceNoMic);
    }
    const type = typeOf();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => void (e.data.size && chunks.push(e.data));
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      if (!keep.current || !chunks.length) return setState("idle");
      setState("transcribing");
      const blob = new Blob(chunks, { type: (rec.mimeType || type || "audio/webm").split(";")[0] });
      const res = await fetch("/api/chat/voice", { method: "POST", body: blob, headers: { "Content-Type": blob.type } }).catch(() => null);
      const body = res ? ((await res.json().catch(() => null)) as { text?: string; code?: string } | null) : null;
      setState("idle");
      if (res?.ok && body?.text) handlers.current.onText(body.text);
      else handlers.current.onError(body?.code === "voice_too_long" ? copy.voiceTooLong : copy.voiceFailed);
    };
    recorder.current = rec;
    keep.current = false;
    rec.start(1000);
    setSeconds(0);
    setState("recording");
  }

  function finish(send: boolean) {
    keep.current = send;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  return { state, seconds, start, send: () => finish(true), cancel: () => finish(false) };
}
