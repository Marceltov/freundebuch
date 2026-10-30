// Voice notes become words before anything else sees them: Claude takes no audio, so a shared voice note is sent to a Whisper
// server the household runs itself (FREUNDEBUCH_TRANSCRIBE_URL, any server with the OpenAI-compatible
// POST /v1/audio/transcriptions, such as speaches), and its transcript is what Claude pre-reads and what is kept once filed.
// The voice note never leaves the household's own servers. Behind Transcriber, so tests and e2e stand in for Whisper.
import type { Logger } from "pino";
import { config } from "./config";
import { logger } from "./log";
import { processState } from "./state";

export interface Transcriber {
  /** What is said in the audio, word for word, or `error` (why not, as logged). */
  transcribe(bytes: Uint8Array, type: string): Promise<{ text: string } | { error: string }>;
}

/** CPU transcription of a few minutes of speech takes a while; past this it has hung. */
const TIMEOUT = 10 * 60_000;

/** The Whisper server at `base` (no trailing slash), with `model`. `deps` stand in for fetch and the logger in tests. */
export function whisperTranscriber(base: string, model: string, deps: { fetch?: typeof fetch; log?: Logger } = {}): Transcriber {
  const log = deps.log ?? logger("transcribe");
  return {
    async transcribe(bytes, type) {
      const form = new FormData();
      form.set("file", new Blob([bytes as BlobPart], { type }), `voice-note.${type.split("/")[1] ?? "audio"}`);
      form.set("model", model);
      form.set("response_format", "json");
      let res: Response;
      try {
        res = await (deps.fetch ?? fetch)(`${base}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log.warn({ error }, "the transcription server can't be reached");
        return { error: `transcription server unreachable: ${error}` };
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        log.warn({ status: res.status, body }, "the transcription failed");
        return { error: `transcription failed (HTTP ${res.status})` };
      }
      const out = (await res.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof out?.text === "string" ? out.text.trim() : "";
      if (!text) {
        log.warn("the transcription came back empty");
        return { error: "nothing was understood in the voice note" };
      }
      return { text };
    },
  };
}

/** The e2e stand-in: every voice note says the same. */
export const fakeTranscriber: Transcriber = {
  async transcribe() {
    return { text: "Hi, hier ist Anna. Wir sind gut in Lissabon angekommen!" };
  },
};

// The transcriber in use: a test's stand-in, Whisper at the configured URL, the e2e stand-in, or none (voice notes aren't taken).
const state = processState("transcribe", () => ({ override: null as Transcriber | null }));
export const setTranscriberForTests = (t: Transcriber | null) => {
  state.override = t;
};
export function transcriber(): Transcriber | null {
  if (state.override) return state.override;
  const url = config.transcribeUrl();
  if (url) return whisperTranscriber(url, config.transcribeModel());
  return config.e2e() ? fakeTranscriber : null;
}
