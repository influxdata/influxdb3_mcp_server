/**
 * Shared error normalization for the write and query paths.
 *
 * Two transports throw two different error shapes: axios (`error.response.*`)
 * for the Core/Enterprise/Clustered HTTP paths, and the InfluxDB SDK's
 * `HttpError` (`error.statusCode`, `error.json`/`error.body`) for the
 * Cloud Dedicated/Serverless paths. `normalizeError` collapses both to one
 * shape so status-branching code doesn't need to know which transport threw.
 */

export interface NormalizedError {
  status: number | undefined;
  body: unknown;
}

export function normalizeError(error: any): NormalizedError {
  if (error?.response) {
    return { status: error.response.status, body: error.response.data };
  }
  if (typeof error?.statusCode === "number") {
    return { status: error.statusCode, body: error.json ?? error.body };
  }
  return { status: undefined, body: undefined };
}

/**
 * Resolve the actionable message out of an InfluxDB error body.
 *
 * Write-path partial-write bodies nest the actionable detail under
 * `data.data[].error_message` (when `accept_partial=true`, an array) or
 * `data.data.error_message` (when `accept_partial=false`, an object) — one
 * level below `data.error`, which is only ever the generic "partial write of
 * line protocol occurred". Those two arms are checked first; query-path
 * bodies never have a `data.data`, so they fall through unaffected.
 */
export function resolveErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>;

    const partialData =
      data.data && typeof data.data === "object"
        ? ((Array.isArray(data.data) ? data.data[0] : data.data) as
            | Record<string, unknown>
            | undefined)
        : undefined;
    if (typeof partialData?.error_message === "string") {
      return partialData.error_message;
    }

    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
    return Object.keys(data).length === 0 ? fallback : JSON.stringify(data);
  }

  if (typeof body === "string") return body;
  return fallback;
}

export type Recovery =
  | "retry"
  | "narrow"
  | "fix_reference"
  | "renew_credential"
  | "change_endpoint"
  | "none";

export function redactCredentials(message: string): string {
  let result = message;
  for (const name of [
    "INFLUX_DB_TOKEN",
    "INFLUX_DB_DATABASE_TOKEN",
    "INFLUX_DB_MANAGEMENT_TOKEN",
  ]) {
    const secret = process.env[name];
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/\b(Bearer|Token)\s+[^\s,;"']+/giu, "$1 [REDACTED]");
}

export function redactErrorDetails(value: unknown): unknown {
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map(redactErrorDetails);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactErrorDetails(item),
      ]),
    );
  }
  return value;
}

export class OperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly recovery: Recovery = "none",
    readonly status?: number,
    readonly retry_after_ms?: number,
    readonly timeout_origin?: "client",
  ) {
    super(redactCredentials(message));
  }
}

// These access outcomes follow the existing HTTP contract. The field error
// matches the recorded Core fixture. Add version-specific recovery signatures
// here only after the operator records the corresponding live response.
const ACCESS_FAILURES: Partial<
  Record<number, { code: string; recovery: Recovery }>
> = {
  401: { code: "credential_invalid", recovery: "renew_credential" },
  403: { code: "access_denied", recovery: "none" },
  404: { code: "not_found_or_denied", recovery: "none" },
};

/** Preserve access evidence across axios, Flight and metadata wrappers. */
export function resolveOperationError(
  error: unknown,
  fallback = "query_failed",
): OperationError {
  if (error instanceof OperationError) {
    return fallback === "metadata_unavailable" && error.code === "query_failed"
      ? new OperationError(
          error.message,
          fallback,
          error.recovery,
          error.status,
          error.retry_after_ms,
          error.timeout_origin,
        )
      : error;
  }
  const { status, body } = normalizeError(error);
  const message = resolveErrorMessage(
    body,
    error instanceof Error ? error.message : "Operation failed",
  );
  const prefix: Record<number, string> = {
    400: "Bad request",
    401: "Unauthorized",
    403: "Access denied",
    404: "Not found or access denied",
    405: "Method not allowed",
    422: "Unprocessable entity",
  };
  // No route has yet established whether 404 masks denied access.
  const access = status === undefined ? undefined : ACCESS_FAILURES[status];
  const clientTimeout =
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
  const code = access?.code ?? (clientTimeout ? "client_timeout" : fallback);
  // Credential renewal and unknown-field recovery have existing observations.
  // Wrong-node, exhaustion, backpressure and timeout signatures need live evidence.
  const recovery: Recovery =
    access?.recovery ??
    (status === 500 && /No field named/u.test(message)
      ? "fix_reference"
      : "none");
  let retryAfter: unknown;
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response;
    if (response && typeof response === "object" && "headers" in response) {
      const headers = response.headers;
      if (headers && typeof headers === "object" && "retry-after" in headers)
        retryAfter = headers["retry-after"];
    }
  }
  const seconds =
    typeof retryAfter === "string" || typeof retryAfter === "number"
      ? Number(retryAfter)
      : NaN;
  const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
  const retryMs =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Number.isFinite(date)
        ? Math.max(0, date - Date.now())
        : undefined;
  return new OperationError(
    `${status ? prefix[status] || "Query failed" : "Query failed"}: ${message}`,
    code,
    recovery,
    status,
    retryMs,
    clientTimeout ? "client" : undefined,
  );
}

export function operationErrorDetails(error: unknown, fallback: string) {
  const resolved = resolveOperationError(error, fallback);
  return {
    code: resolved.code,
    message: resolved.message,
    access_outcome: [
      "not_found",
      "access_denied",
      "credential_invalid",
      "metadata_unavailable",
      "not_found_or_denied",
    ].includes(resolved.code)
      ? resolved.code
      : "unknown",
    recovery: resolved.recovery,
    retryable: resolved.recovery === "retry",
    ...(resolved.timeout_origin && { timeout_origin: resolved.timeout_origin }),
    ...(resolved.status !== undefined && { status: resolved.status }),
    ...(resolved.retry_after_ms !== undefined && {
      retry_after_ms: resolved.retry_after_ms,
    }),
  };
}
