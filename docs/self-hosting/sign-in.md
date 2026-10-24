# Sign-in with authentik

There is no password and no open mode: without the OIDC variables nobody can sign in. freundebuch is written against authentik, but any OIDC provider that issues a verified email works.

## In authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider.**
    - Client type: *Confidential*.
    - Redirect URI (strict): `https://freundebuch.example.com/api/oidc/callback`
    - Scopes: the defaults (`openid`, `email`, `profile`).
2. **Applications → Applications → Create**, slug `freundebuch`, with that provider.
3. Bind the application to the household's users or to a group. Only they can sign in.

## In freundebuch

Set the three variables from the provider's page:

```bash
FREUNDEBUCH_OIDC_ISSUER=https://authentik.example.com/application/o/freundebuch/
FREUNDEBUCH_OIDC_CLIENT_ID=...
FREUNDEBUCH_OIDC_CLIENT_SECRET=...
```

The first sign-in creates the user, named after the provider's `name` claim (or `preferred_username`, or the email). That name is what your partner sees. `FREUNDEBUCH_OIDC_ALLOW` can narrow access further, but normally authentik's binding is enough.

## Sessions

- The browser stays signed in for 7 days.
- A connected Claude stays signed in for up to 90 days, then asks you to sign in again.
- Changing `FREUNDEBUCH_SECRET` signs out every browser and every connected Claude at once. It's the way to revoke everything.

Why freundebuch runs its own OAuth server instead of letting Claude talk to authentik directly: [ADR 0003](../adr/0003-authentik-sign-in-and-own-oauth-server.md).
