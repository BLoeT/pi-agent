/** An expected error that can be shown to the client without exposing internals. */
export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function redact(value) {
  return String(value)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");
}

export function clientError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  if (error?.type === "entity.too.large") {
    return { status: 413, body: { error: "Anfrage zu groß", code: "BODY_TOO_LARGE" } };
  }
  if (error instanceof SyntaxError && error?.status === 400) {
    return { status: 400, body: { error: "Ungültiges JSON", code: "INVALID_JSON" } };
  }
  if (error?.name === "AbortError") {
    return { status: 409, body: { error: "Anfrage abgebrochen", code: "CANCELLED" } };
  }
  return { status: 500, body: { error: "Die Anfrage konnte nicht verarbeitet werden", code: "INTERNAL_ERROR" } };
}
