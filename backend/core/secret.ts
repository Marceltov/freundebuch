// The server secret: signs OAuth tokens and sessions. FREUNDEBUCH_SECRET, or else 32 random bytes generated once and kept in
// ${DATA_DIR}/secret (mode 0600), so a restart keeps every client signed in.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { processState } from "./state";

const state = processState("secret", () => ({}) as { secret?: Buffer });

export const secretPath = () => join(config.dataDir(), "secret");

// A short key makes tokens forgeable. Fail loudly instead of regenerating the key, which would sign everyone out.
function strong(key: Buffer, where: string): Buffer {
  if (key.length < 32) throw new Error(`${where} must be at least 32 bytes (e.g. openssl rand -hex 32), got ${key.length}`);
  return key;
}

const isErrno = (e: unknown, code: string) => e instanceof Error && (e as NodeJS.ErrnoException).code === code;

// The stored bytes, or 32 new random ones written first. Never replaces an existing file.
function loadOrCreate(): Buffer {
  const file = secretPath();
  try {
    return readFileSync(/*turbopackIgnore: true*/ file);
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
  }
  mkdirSync(/*turbopackIgnore: true*/ config.dataDir(), { recursive: true });
  try {
    const s = randomBytes(32);
    writeFileSync(/*turbopackIgnore: true*/ file, s, { mode: 0o600, flag: "wx" });
    return s;
  } catch (e) {
    if (!isErrno(e, "EEXIST")) throw e;
    return readFileSync(/*turbopackIgnore: true*/ file); // another process won the race
  }
}

export function secret(): Buffer {
  if (state.secret) return state.secret;
  const env = config.secret();
  if (env) return (state.secret = strong(Buffer.from(env), "FREUNDEBUCH_SECRET"));
  return (state.secret = strong(loadOrCreate(), secretPath()));
}

export const resetSecretForTests = (): void => {
  state.secret = undefined;
};
