# Getting started

You need Docker, a domain with TLS in front of it (a reverse proxy), and an OIDC provider. The docs use authentik, but any OIDC provider works.

## 1. Create the sign-in

In authentik, create an OAuth2/OpenID provider and an application for freundebuch. Register this redirect URI (strict):

```
https://freundebuch.example.com/api/oidc/callback
```

Bind the application to the people who share the instance. [Sign-in with authentik](self-hosting/sign-in.md) has the details.

## 2. Run the container

```yaml title="compose.yaml"
services:
  freundebuch:
    image: ghcr.io/marceltov/freundebuch:main
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PUBLIC_URL: https://freundebuch.example.com
      FREUNDEBUCH_OIDC_ISSUER: https://authentik.example.com/application/o/freundebuch/
      FREUNDEBUCH_OIDC_CLIENT_ID: ...
      FREUNDEBUCH_OIDC_CLIENT_SECRET: ...
      FREUNDEBUCH_TRUST_PROXY: "1"
    volumes:
      - freundebuch-data:/data
volumes:
  freundebuch-data:
```

```bash
docker compose up -d
curl -fsS https://freundebuch.example.com/health   # 200 once it can reach its database
```

Every variable is explained in [Configuration](self-hosting/configuration.md).

## 3. Sign in

Open `https://freundebuch.example.com` and sign in with authentik. The first sign-in creates your user, and the start page shows only you in the middle. Your partner signs in the same way.

## 4. Connect Claude

In claude.ai, open **Settings → Connectors → Add custom connector** and enter:

```
https://freundebuch.example.com/mcp
```

Sign in with authentik when asked. The connector then works in the Claude apps on your phone too. For Claude Code and other clients, see [Connect Claude](self-hosting/connect-claude.md).

## 5. Ramble

Tell Claude about the last time you met someone:

> Had coffee with Sarah. She got the job at Siemens, starts in November, and they're moving to Munich in March. Ella started kindergarten. I said I'd send her the contact of our moving company.

Claude files it and reads back what it saved. Next, read [Rambling to Claude](using/rambling.md) to see what Claude picks up and when it asks you first.
