# Configuration

Everything is an environment variable. [`.env.example`](https://github.com/Marceltov/freundebuch/blob/main/.env.example) has the same list with comments.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | derived from the request | The address clients reach freundebuch at (OAuth issuer, links in notifications). Set it behind a reverse proxy. |
| `DATA_DIR` | `/data` | Where the database (`freundebuch.db`) and the generated secret live. Mount a volume here. |
| `PORT` | `3000` | Port the server listens on. |
| `TZ` | `Europe/Berlin` | Birthdays and "today" are computed in this IANA time zone. |
| `FREUNDEBUCH_SECRET` | generated into `${DATA_DIR}/secret` | Signs OAuth tokens and sign-in cookies; at least 32 bytes (`openssl rand -hex 32`). Changing it signs out every browser and every connected Claude. |
| `FREUNDEBUCH_OIDC_ISSUER` | none, required | OIDC issuer URL (authentik). |
| `FREUNDEBUCH_OIDC_CLIENT_ID` | none, required | Client ID. |
| `FREUNDEBUCH_OIDC_CLIENT_SECRET` | none, required | Client secret. |
| `FREUNDEBUCH_OIDC_ALLOW` | `*` | Optional extra restriction, comma-separated: addresses or `@domain` (verified email). By default authentik alone decides who gets in. |
| `FREUNDEBUCH_NOTIFY_AT` | `08:00` | Time of day (HH:MM, `TZ`) the daily reminders go out. |
| `FREUNDEBUCH_TRUST_PROXY` | off | Set to `1` behind a reverse proxy that sets `X-Forwarded-For/-Proto/-Host`. Without it those headers are ignored and every client shares one failed-sign-in bucket. |
| `FREUNDEBUCH_RATE_LIMIT` | `60` | Failed sign-ins per minute and client IP; `0` turns the limit off. |
| `FREUNDEBUCH_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` or `silent`. |
