---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# Voice notes are transcribed by a self-hosted Whisper, and only their words are kept

## Context and Problem Statement

Prüfen should take any file the user shares, including WhatsApp voice notes, and Erzählen should take a spoken message the way WhatsApp does ([#58](https://github.com/Marceltov/freundebuch/issues/58)). The Claude API takes text, images and PDFs, but no audio, and Anthropic offers no transcription. Audio has to become words first. Voice notes are private: often a friend's own voice, said to the user alone.

## Considered Options

* **A Whisper server the household runs, behind the OpenAI-compatible transcription API** (chosen).
* **A hosted speech-to-text API** (OpenAI, Deepgram and others).
* **Whisper inside the freundebuch image.**
* **The browser's own dictation** for Erzählen only.

## Decision Outcome

Chosen option: a self-hosted Whisper, reached at `FREUNDEBUCH_TRANSCRIBE_URL` through `POST /v1/audio/transcriptions`.

* **A shared voice note is a file like any other.** It is stored as it came while it waits, Whisper transcribes it when it is read, and Claude pre-reads the transcript. The transcript kept is Whisper's, word for word, not Claude's retelling. Filing keeps only the transcript and deletes the audio, as with images ([V4](../values.md#v4-only-words-are-kept), [ADR 0014](0014-shared-files-are-worked-through-with-claude.md)). Erzählen and the MCP `inbox` hand Claude the transcript, never the audio. A transcript made before a failed pre-read is kept, so a retry doesn't transcribe again.
* **A message spoken into Erzählen is never stored.** `POST /api/chat/voice` transcribes it and hands back the words, which the app sends as the user's message, so it becomes a ramble like a typed one. It is a web-app route, like `/api/chat`, not part of the REST API.
* **Without a transcription server there is no audio.** Audio files are refused with a reason, and Erzählen shows no microphone.
* **Any server with the OpenAI-compatible API works**, such as speaches. The default model is `large-v3-turbo`, which handles German well and runs on CPU (int8) at tens of seconds per minute of speech.

### Consequences

* Good, because voice notes never leave the household's own servers ([V6](../values.md#v6-self-hosting-has-everything)), and the freundebuch image stays small.
* Good, because the transcription server is replaceable: anything that speaks the same API, on a GPU or not.
* Bad, because self-hosting freundebuch with voice notes now means running a second service.
* Bad, because a misheard name is kept as heard. Claude resolves people with find_person and asks, and the transcript can be corrected like any other.
* Neutral: transcription costs nothing per request and isn't counted against the daily limit; the pre-read of a voice note is, as for every file.

## More Information

The hosted APIs were ruled out because they would send private voice notes to a third party. Whisper in the image would make every installation carry a model of several hundred MB and a CPU spike inside the app's process. Browser dictation works for Erzählen already (the keyboard's microphone), but it doesn't help with voice notes shared in, and it sends the audio to the browser's or phone's vendor.
