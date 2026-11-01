// What the backend throws on purpose; the HTTP and MCP layers map `code` to a status or tool error.
export class FreundebuchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends FreundebuchError {
  constructor(message = "Not found") {
    super("not_found", message);
  }
}

export class ForbiddenError extends FreundebuchError {
  constructor(message = "Forbidden") {
    super("forbidden", message);
  }
}

/** A new user signing in without an invitation while registration is closed. */
export class NotInvitedError extends ForbiddenError {
  constructor() {
    super("Signing up needs an invitation");
  }
}

export class InvalidInputError extends FreundebuchError {
  constructor(message: string) {
    super("invalid_input", message);
  }
}

export class AmbiguousError extends FreundebuchError {
  constructor(message: string) {
    super("ambiguous", message);
  }
}

// No (or no longer a valid) sign-in: no identity cookie, no access token for this instance, or a user that is gone. The OIDC flow
// throws it too, after logging why; the browser only ever sees "sign-in didn't work".
export class AuthError extends FreundebuchError {
  constructor(message = "Sign-in required") {
    super("unauthorized", message);
  }
}

// A request the API can't read: a query, path or body that doesn't match the operation's description. Domain input that is
// readable but wrong is InvalidInputError.
export class InvalidRequestError extends FreundebuchError {
  constructor(message: string) {
    super("invalid_request", message);
  }
}
