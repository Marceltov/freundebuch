# Configuration

Everything is an environment variable. [`.env.example`](https://github.com/Marceltov/freundebuch/blob/main/.env.example) has the same list with comments.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | derived from the request | The address clients reach freundebuch at (OAuth issuer, links in notifications). Set it behind a reverse proxy. |
| `DATA_DIR` | `/data` | Where the databases (`freundebuch.db`, `households/`, `instance.db`) and the generated secret live. Mount a volume here. |
| `PORT` | `3000` | Port the server listens on. |
| `TZ` | `Europe/Berlin` | Birthdays and "today" are computed in this IANA time zone. |
| `FREUNDEBUCH_SECRET` | generated into `${DATA_DIR}/secret` | Signs OAuth tokens and sign-in cookies; at least 32 bytes (`openssl rand -hex 32`). Changing it signs out every browser and every connected Claude. |
| `FREUNDEBUCH_OIDC_ISSUER` | none, required | OIDC issuer URL (authentik). |
| `FREUNDEBUCH_OIDC_CLIENT_ID` | none, required | Client ID. |
| `FREUNDEBUCH_OIDC_CLIENT_SECRET` | none, required | Client secret. |
| `FREUNDEBUCH_OIDC_ALLOW` | `*` | Optional extra restriction, comma-separated: addresses or `@domain` (verified email). By default authentik alone decides who gets in. |
| `FREUNDEBUCH_HOUSEHOLDS` | `one` | `one`: everyone who signs in shares one book. `many`: a first sign-in joins the household whose invitation it followed (Settings → Haushalt, or the `invite` tool) or starts a book of its own, kept in a file of its own. Who may sign in at all is still up to authentik. |
| `FREUNDEBUCH_NOTIFY_AT` | `08:00` | Time of day (HH:MM, `TZ`) the daily reminders go out. |
| `FREUNDEBUCH_TRUST_PROXY` | off | Set to `1` behind a reverse proxy that sets `X-Forwarded-For/-Proto/-Host`. Without it those headers are ignored and every client shares one failed-sign-in bucket. |
| `FREUNDEBUCH_RATE_LIMIT` | `60` | Failed sign-ins per minute and client IP; `0` turns the limit off. |
| `FREUNDEBUCH_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` or `silent`. |
| `FREUNDEBUCH_ANTHROPIC_API_KEY` | none | An Anthropic API key (console.anthropic.com) turns on the chat in the web app ("Erzählen"). Without it the app has no chat; Claude over MCP works either way. Usage is billed to the key's account. |
| `FREUNDEBUCH_ANTHROPIC_MODEL` | `claude-sonnet-5-5` | The Claude model the chat uses. |
| `FREUNDEBUCH_CHAT_DAILY_LIMIT` | `100` | Messages each user may send the chat per day. Each shared file counts as one. |
| `FREUNDEBUCH_TRANSCRIBE_URL` | none | A Whisper server with the OpenAI-compatible `POST /v1/audio/transcriptions`, such as [speaches](https://github.com/speaches-ai/speaches), at its address without `/v1` (`http://whisper:8000`). It turns on [voice notes](../using/sharing.md#voice-notes) and the microphone in Erzählen. Run it yourself, next to freundebuch and without a public route: voice notes are private, and Claude takes no audio. On CPU, `large-v3-turbo` with int8 transcribes a minute of speech in tens of seconds. |
| `FREUNDEBUCH_TRANSCRIBE_MODEL` | `deepdml/faster-whisper-large-v3-turbo-ct2` | The model the Whisper server runs, as it names it. |
| `FREUNDEBUCH_STORAGE` | `files` | Where [shared files](../using/sharing.md) are kept: `files` (under `${DATA_DIR}/files/`, older ones in `screenshots/`) or `s3`. Sharing needs `FREUNDEBUCH_ANTHROPIC_API_KEY`. |
| `FREUNDEBUCH_S3_ENDPOINT` | none, required for `s3` | The S3-compatible endpoint, such as `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` or your MinIO/Garage. |
| `FREUNDEBUCH_S3_BUCKET` | none, required for `s3` | The bucket. Keep it private: freundebuch serves the images itself, after checking who may see them. |
| `FREUNDEBUCH_S3_REGION` | `us-east-1` | The region the request is signed for (`garage` for Garage, `auto` for R2). |
| `FREUNDEBUCH_S3_ACCESS_KEY_ID` | none, required for `s3` | Access key with read, write and delete on the bucket. |
| `FREUNDEBUCH_S3_SECRET_ACCESS_KEY` | none, required for `s3` | Its secret. |
| `FREUNDEBUCH_S3_PATH_STYLE` | off | `1` for `endpoint/bucket/key` addressing (MinIO, Garage); otherwise `bucket.endpoint/key`. |
