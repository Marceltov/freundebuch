import { expect, test } from "vitest";
import { whisperTranscriber } from "./transcribe";
import { logger } from "./log";

const log = logger("test");

test("a voice note goes to the Whisper server as an OpenAI transcription request, and its text comes back", async () => {
  const calls: { url: string; form: FormData }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    return Response.json({ text: "  Hallo, hier ist Anna.  " });
  }) as unknown as typeof globalThis.fetch;
  const t = whisperTranscriber("http://whisper:8000", "large-v3-turbo", { fetch, log });
  expect(await t.transcribe(new Uint8Array([1, 2, 3]), "audio/ogg")).toEqual({ text: "Hallo, hier ist Anna." });
  expect(calls[0].url).toBe("http://whisper:8000/v1/audio/transcriptions");
  expect(calls[0].form.get("model")).toBe("large-v3-turbo");
  const file = calls[0].form.get("file") as File;
  expect([file.name, file.type, file.size]).toEqual(["voice-note.ogg", "audio/ogg", 3]);
});

test("a server that fails, can't be reached or understood nothing gives the reason", async () => {
  const answering = (r: () => Response) => whisperTranscriber("http://w", "m", { fetch: (async () => r()) as unknown as typeof fetch, log });
  expect(await answering(() => new Response("boom", { status: 500 })).transcribe(new Uint8Array([1]), "audio/ogg")).toEqual({
    error: "transcription failed (HTTP 500)",
  });
  expect(await answering(() => Response.json({ text: " " })).transcribe(new Uint8Array([1]), "audio/ogg")).toEqual({
    error: "nothing was understood in the voice note",
  });
  const down = whisperTranscriber("http://w", "m", {
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
    log,
  });
  expect(await down.transcribe(new Uint8Array([1]), "audio/ogg")).toEqual({ error: "transcription server unreachable: ECONNREFUSED" });
});
