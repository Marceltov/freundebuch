// Every environment variable the backend reads. Getters, not constants: tests change the environment
// between cases, and DATA_DIR is only known at runtime.
const env = (name: string) => process.env[name] ?? "";

export const LOG_LEVELS = ["error", "warn", "info", "debug", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const NOTIFY_AT = /^([01]\d|2[0-3]):[0-5]\d$/;

// The time of day (local, TZ) the daily reminders go out. Unset or empty means the default; anything else must be HH:MM.
function notifyAt(): string {
  const v = env("FREUNDEBUCH_NOTIFY_AT").trim();
  if (v === "") return "08:00";
  if (!NOTIFY_AT.test(v)) throw new Error(`FREUNDEBUCH_NOTIFY_AT must be a time as HH:MM (00:00 to 23:59), got "${v}"`);
  return v;
}

// The zone "today" is computed in: TZ, or Europe/Berlin when unset. Must be an IANA zone name.
function timeZone(): string {
  const tz = env("TZ").trim() || "Europe/Berlin";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    throw new Error(`TZ must be an IANA time zone such as Europe/Berlin, got "${tz}"`);
  }
  return tz;
}

export const config = {
  // Where the database (freundebuch.db) and the generated secret live.
  dataDir: () => env("DATA_DIR") || "/data",
  // The address clients reach this instance at; no trailing slash. Unset: derived from the request.
  publicUrl: (): string | undefined => env("PUBLIC_URL").replace(/\/+$/, "") || undefined,
  // Empty means unset: compose passes ${FREUNDEBUCH_SECRET:-}.
  secret: (): string | undefined => env("FREUNDEBUCH_SECRET") || undefined,
  notifyAt,
  timeZone,
  // Who signs in: authentik (or any OIDC provider), see oidc/config.ts. `allow` is a comma-separated list of addresses,
  // @domain entries or *, trimmed and lowercased; unset or empty means * (authentik alone decides who gets in).
  oidc: () => {
    const allow = env("FREUNDEBUCH_OIDC_ALLOW").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
    return {
      issuer: env("FREUNDEBUCH_OIDC_ISSUER"),
      clientId: env("FREUNDEBUCH_OIDC_CLIENT_ID"),
      clientSecret: env("FREUNDEBUCH_OIDC_CLIENT_SECRET"),
      allow: allow.length ? allow : ["*"],
    };
  },
  // X-Forwarded-For/-Proto/-Host are believed only behind a proxy that sets them (see limits.ts and urls.ts).
  trustProxy: () => env("FREUNDEBUCH_TRUST_PROXY") === "1",
  // Failed sign-ins per minute and IP; 0 or below turns the limit off. Unset or not a number → 60.
  rateLimit: (): number => ((n) => (Number.isInteger(n) ? n : 60))(Number.parseInt(env("FREUNDEBUCH_RATE_LIMIT").trim(), 10)),
  // Unset, empty or not a level → info.
  // The Playwright tests' sign-in without authentik (auth/e2e.ts). Never in a production build: Next inlines NODE_ENV when it
  // builds, so in the image this is false whatever FREUNDEBUCH_E2E says.
  e2e: (): boolean => env("FREUNDEBUCH_E2E") === "1" && process.env.NODE_ENV !== "production",
  logLevel: (): LogLevel => ((l) => ((LOG_LEVELS as readonly string[]).includes(l) ? (l as LogLevel) : "info"))(env("FREUNDEBUCH_LOG_LEVEL").trim().toLowerCase()),
};
