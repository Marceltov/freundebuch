// The one logger: pino, one JSON object per line on stdout (level label, ISO time, component, msg, fields), no
// transports. FREUNDEBUCH_LOG_LEVEL sets the level. Never log what people said (transcripts, facts, promises), names of persons,
// tokens, secrets, codes, state, nonce, cookies, e-mail addresses, claim values, client IP
// addresses, request headers or bodies. An Error goes in `err`, which errorFields() scrubs. The redaction below is
// only a safety net.
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import pino, { type DestinationStream, type Logger } from "pino";
import { config } from "./config";
import { processState } from "./state";

// A safety net only: pino's `*.x` wildcards match one level down, so a value nested deeper or inside an array passes.
const REDACT = ["password", "secret", "token", "authorization", "cookie", "client_secret", "code", "state", "nonce", "email", "name"].flatMap((p) =>
  ["code", "state", "nonce", "client_secret"].includes(p) ? [p] : [p, `*.${p}`],
);
const CAP = 200;

// Strings capped and without control, format or line-separator characters (JSON escapes them anyway, but a bidi
// override or a forged-looking line has no business in a log), in a field or two levels down.
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").slice(0, CAP);
  if (depth >= 2 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  return Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, depth + 1)])) : v;
}

// `destination` may throw: nothing a logger does ever reaches the caller.
export function createLogger(destination: DestinationStream, level: string = config.logLevel()): Logger {
  const safe = {
    write: (line: string) => {
      try {
        destination.write(line);
      } catch {}
    },
  };
  return pino(
    {
      level,
      base: undefined, // no pid or hostname
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: errorFields },
      // `log.warn(error)` would make the error's (unscrubbed) message the msg: it goes into `err`, and msg is its type.
      hooks: {
        logMethod(args, method) {
          const [first, msg] = args as unknown[];
          if (!(first instanceof Error)) return method.apply(this, args);
          return method.apply(this, [{ err: first }, typeof msg === "string" ? msg : first.name]);
        },
      },
      formatters: {
        level: (label) => ({ level: label }),
        // `err` keeps its stack (errorFields caps it).
        log: (o) => {
          try {
            return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "err" ? v : clean(v)]));
          } catch {
            return {};
          }
        },
      },
      redact: { paths: REDACT, censor: "[redacted]" },
    },
    safe,
  );
}

// One root and one child per component for the whole process (Next loads this module once per bundle). Tests
// point `sink` elsewhere with logTo().
type Sink = { write(line: string): unknown };
const state = processState("log", () => {
  const s = { sink: pino.destination(1) as Sink, children: new Map<string, Logger>() };
  return Object.assign(s, { root: createLogger({ write: (line: string) => s.sink.write(line) }) });
});

export const log: Logger = state.root;

export function logger(component: string): Logger {
  let c = state.children.get(component);
  if (!c) state.children.set(component, (c = log.child({ component })));
  return c;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const realpath = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// Everything below DATA_DIR becomes `<DATA_DIR>/<path>`: fs errors name files there, and the secret lives in it. DATA_DIR as given, resolved, and with symlinks resolved.
export function scrubPaths(s: string): string {
  const d = config.dataDir();
  const dirs = new Set([join(d), resolve(d), realpath(resolve(d))].map((p) => p.replace(/\/+$/, "")).filter(Boolean));
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(`${escapeRe(dir)}/[^\\s'"]+`, "g"), `${dir}/<path>`);
  return s;
}

// `err` as logged: its type, message and stack with paths under DATA_DIR scrubbed, and the fs fields that name no path.
// Anything thrown that isn't an Error is logged by its type only.
export function errorFields(e: unknown): { type: string; message?: string; stack?: string; code?: string; errno?: number; syscall?: string } {
  if (!(e instanceof Error)) return { type: typeof e };
  const { code, errno, syscall } = e as NodeJS.ErrnoException;
  return { type: e.name, message: scrubPaths(e.message).slice(0, CAP), stack: e.stack && scrubPaths(e.stack).slice(0, 4000), code, errno, syscall };
}

// For tests: every logger writes to `write` at `level` until the returned function puts things back.
export function logTo(write: (line: string) => void, level: string = "debug"): () => void {
  const before = { sink: state.sink, level: log.level };
  const setLevel = (l: string) => {
    log.level = l;
    for (const c of state.children.values()) c.level = l;
  };
  state.sink = { write };
  setLevel(level);
  return () => {
    state.sink = before.sink;
    setLevel(before.level);
  };
}

// For tests: what `run` logged, each line parsed and without its time.
export async function logsOf(run: () => unknown, level: string = "debug"): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const restore = logTo((l) => void lines.push(l), level);
  try {
    await run();
  } finally {
    restore();
  }
  return lines.map((l) => {
    const entry = JSON.parse(l);
    delete entry.time;
    return entry;
  });
}
