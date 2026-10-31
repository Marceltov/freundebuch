// The HTTP status for each refusal, and the JSON error body every API endpoint answers with.
import { AmbiguousError, AuthError, ForbiddenError, FreundebuchError, InvalidInputError, InvalidRequestError, NotFoundError } from "../core/errors";
import { errorFields, logger } from "../core/log";

const log = logger("http");

export const ERROR_CODES = ["invalid_request", "invalid_input", "unauthorized", "forbidden", "not_found", "ambiguous", "internal"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: [new (...args: never[]) => FreundebuchError, number][] = [
  [InvalidRequestError, 400],
  [InvalidInputError, 400],
  [AuthError, 401],
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [AmbiguousError, 409],
];

export const statusOf = (e: FreundebuchError) => STATUS.find(([cls]) => e instanceof cls)?.[1] ?? 500;

export type ErrorReply = { status: number; body: { error: string; code: ErrorCode } };

// Anything that isn't a FreundebuchError is a bug or a disk failure: logged, and a bare 500 that says nothing of it.
export function errorReply(e: unknown): ErrorReply {
  if (!(e instanceof FreundebuchError)) {
    log.error({ err: errorFields(e) }, "request failed");
    return { status: 500, body: { error: "internal error", code: "internal" } };
  }
  return { status: statusOf(e), body: { error: e.message, code: e.code as ErrorCode } };
}
