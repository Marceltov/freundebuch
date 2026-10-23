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
