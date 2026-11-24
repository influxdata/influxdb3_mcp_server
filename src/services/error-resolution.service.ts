import { RequestTimedOutError } from "@influxdata/influxdb3-client";

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

    const rejected = everyRejectedLine(body);
    if (rejected.length === 1) return rejected[0].error_message;
    if (rejected.length > 0) {
      const shown = rejected
        .slice(0, MESSAGE_LINE_LIMIT)
        .map((line) =>
          line.line_number === undefined
            ? line.error_message
            : `line ${line.line_number}: ${line.error_message}`,
        );
      const hidden = rejected.length - shown.length;
      return hidden > 0
        ? `${shown.join("; ")}; and ${hidden} more rejected lines`
        : shown.join("; ");
    }

    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
    return Object.keys(data).length === 0 ? fallback : JSON.stringify(data);
  }

  // A 403 from Core or Enterprise 3.12.1 has an empty body.
  if (typeof body === "string") return body || fallback;
  return fallback;
}

const MESSAGE_LINE_LIMIT = 5;
const REJECTED_LINES_LIMIT = 100;

export interface RejectedLine {
  line_number?: number;
  error_message: string;
  original_line?: string;
}

export function everyRejectedLine(body: unknown): RejectedLine[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return [];
  const entries = Array.isArray(data) ? data : [data];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    if (typeof line.error_message !== "string") return [];
    return [
      {
        error_message: line.error_message,
        ...(typeof line.line_number === "number" && {
          line_number: line.line_number,
        }),
        ...(typeof line.original_line === "string" && {
          original_line: line.original_line,
        }),
      },
    ];
  });
}

const PARTIAL_WRITE_HEADER = "influxdata-partial-write";
const V2_PARTIAL_WRITE_PREFIX =
  /^partial write has occurred, errors encountered on line\(s\): /u;
const V2_LINE_ERROR_MARKER = /line (\d+): /gu;
const SEPARATOR_BEFORE_NEXT_LINE_ERROR = /[,;]\s*$/u;

function responseHeader(error: any, name: string): string | undefined {
  const headers = error?.response?.headers ?? error?.headers;
  if (!headers) return undefined;
  const value =
    typeof headers.get === "function" ? headers.get(name) : headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}

/**
 * Rejected lines from an `/api/v2/write` partial write, as Cloud Dedicated and
 * Cloud Serverless report it: a 400 with `influxdata-partial-write: true` and
 * a JSON body whose `message` lists each rejected line, plus a top-level
 * `line` (claims 20261123-0037, 0038).
 */
export function everyV2PartialWriteLine(
  error: any,
  body: unknown,
): RejectedLine[] {
  if (!body || typeof body !== "object") return [];
  const { message, line } = body as Record<string, unknown>;
  if (typeof message !== "string") return [];
  const prefix = V2_PARTIAL_WRITE_PREFIX.exec(message);
  const flagged = responseHeader(error, PARTIAL_WRITE_HEADER) === "true";
  if (!prefix && !flagged) return [];

  const lineErrors = prefix ? message.slice(prefix[0].length) : message;
  const markers = [...lineErrors.matchAll(V2_LINE_ERROR_MARKER)];
  if (markers.length === 0) {
    return [
      {
        error_message: lineErrors,
        ...(typeof line === "number" && { line_number: line }),
      },
    ];
  }
  return markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? lineErrors.length;
    return {
      line_number: Number(marker[1]),
      error_message: lineErrors
        .slice(start, end)
        .trim()
        .replace(SEPARATOR_BEFORE_NEXT_LINE_ERROR, ""),
    };
  });
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

// Observed on Core and Enterprise 3.12.1: a token that may not read a
// database gets 403 whether or not the database exists, and 404 reaches only
// a token that can see the database is missing. Add version-specific
// recovery signatures here only after the operator records the corresponding
// live response.
const ACCESS_FAILURES: Partial<
  Record<number, { code: string; recovery: Recovery }>
> = {
  401: { code: "credential_invalid", recovery: "renew_credential" },
  403: { code: "not_found_or_denied", recovery: "none" },
  404: { code: "not_found", recovery: "none" },
};

/** Server messages that identify their own recovery. */
const RECOVERY_SIGNATURES: Array<{
  statuses: number[];
  pattern: RegExp;
  recovery: Recovery;
  /** Replaces the status prefix of the message. */
  hint?: string;
}> = [
  // Recorded Core unknown-field error.
  { statuses: [500], pattern: /No field named/u, recovery: "fix_reference" },
  // Unknown table: 400, plain text, on Core and Enterprise 3.11.7 and 3.12.1.
  {
    statuses: [400],
    pattern: /Error during planning: table '[^']+' not found/u,
    recovery: "fix_reference",
  },
  // Enterprise 3.12.1 ingest-only node.
  {
    statuses: [405],
    pattern: /send this query to a query node/u,
    recovery: "change_endpoint",
  },
  // The query memory pool ran out: 500 on Core 3.12.1, 429 on Enterprise.
  {
    statuses: [500, 429],
    pattern: /Resources exhausted/u,
    recovery: "narrow",
    hint: "Query ran out of server memory. Narrow the query (a shorter time range, fewer columns, or an aggregate) before running it again",
  },
];

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
    403: "Access denied or not found",
    404: "Not found",
    405: "Method not allowed",
    422: "Unprocessable entity",
  };
  const access = status === undefined ? undefined : ACCESS_FAILURES[status];
  const clientTimeout = clientStoppedWaiting(error);
  const code = access?.code ?? (clientTimeout ? "client_timeout" : fallback);
  const signature = RECOVERY_SIGNATURES.find(
    (candidate) =>
      status !== undefined &&
      candidate.statuses.includes(status) &&
      candidate.pattern.test(message),
  );
  const recovery: Recovery = access?.recovery ?? signature?.recovery ?? "none";
  const label =
    signature?.hint ??
    (status ? prefix[status] || "Query failed" : "Query failed");
  return new OperationError(
    `${label}: ${message}`,
    code,
    recovery,
    status,
    retryAfterMs(error),
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

export interface WriteOutcome {
  accept_partial?: boolean;
  stored: "some" | "none" | "unknown";
  stored_source: "inferred";
  lines_submitted: number;
  lines_rejected: number;
  rejected_lines: RejectedLine[];
  rejected_lines_truncated: boolean;
}

export class WriteOperationError extends OperationError {
  constructor(
    message: string,
    code: string,
    recovery: Recovery,
    status: number | undefined,
    retryAfterMs: number | undefined,
    readonly fix?: string,
    readonly write?: WriteOutcome,
    timeoutOrigin?: "client",
  ) {
    super(message, code, recovery, status, retryAfterMs, timeoutOrigin);
  }
}

function retryAfterMs(error: unknown): number | undefined {
  const value = responseHeader(error, "retry-after");
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function lineProtocolRecords(lineProtocol: string): string[] {
  return lineProtocol
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

function unquotedUnescapedSections(line: string): string[] {
  const sections: string[] = [];
  let current = "";
  let inQuotedFieldValue = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      current += char + line[i + 1];
      i++;
    } else if (char === '"') {
      inQuotedFieldValue = !inQuotedFieldValue;
      current += char;
    } else if (char === " " && !inQuotedFieldValue) {
      if (current !== "") sections.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") sections.push(current);
  return sections;
}

export function hasExplicitTimestamp(line: string): boolean {
  const sections = unquotedUnescapedSections(line.trim());
  return sections.length >= 3 && /^-?\d+$/u.test(sections[sections.length - 1]);
}

function inferStoredLines(
  acceptPartial: boolean | undefined,
  rejectedCount: number,
  submitted: number,
): WriteOutcome["stored"] {
  if (rejectedCount === 0 || acceptPartial === undefined) return "unknown";
  const serverDiscardsWholeRequest = !acceptPartial;
  const everyLineRejected = rejectedCount >= submitted;
  return serverDiscardsWholeRequest || everyLineRejected ? "none" : "some";
}

const STATUSES_WHERE_SERVER_REJECTED_THE_WRITE = [429, 503];
const STATUSES_WHERE_THE_WRITE_MAY_HAVE_BEEN_STORED = [504];
const CONNECTION_REFUSED = "ECONNREFUSED";
const CONNECTION_RESET = "ECONNRESET";

function networkErrorCode(error: any): string | undefined {
  const code = error?.code ?? error?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

const AXIOS_TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];

function clientStoppedWaiting(error: unknown): boolean {
  return (
    error instanceof RequestTimedOutError ||
    AXIOS_TIMEOUT_CODES.includes(networkErrorCode(error) ?? "")
  );
}

const WRITE_PREFIXES: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Access denied",
  404: "Not found",
  413: "Request entity too large",
  422: "Unprocessable entity",
  429: "Too many requests, retry the write",
  503: "Service temporarily unavailable, retry the write",
  504: "Gateway timeout",
};

export function resolveWriteError(
  error: any,
  database: string,
  request: { lineProtocol: string; acceptPartial?: boolean },
): WriteOperationError {
  const { status, body } = normalizeError(error);
  const detail = resolveErrorMessage(
    body,
    error instanceof Error ? error.message : String(error),
  );
  const message =
    status !== undefined && status in WRITE_PREFIXES
      ? `${WRITE_PREFIXES[status]}: ${detail}`
      : `Failed to write data to database '${database}': ${detail}`;
  const retryAfter = retryAfterMs(error);
  const timeoutOrigin =
    status === undefined && clientStoppedWaiting(error) ? "client" : undefined;

  const v3Rejected = everyRejectedLine(body);
  const v2Rejected =
    v3Rejected.length === 0 ? everyV2PartialWriteLine(error, body) : [];
  const serverReportedPartialWrite = v2Rejected.length > 0;
  const rejected = serverReportedPartialWrite ? v2Rejected : v3Rejected;
  const records = lineProtocolRecords(request.lineProtocol);
  const submitted = records.length;
  const rejectedCount = new Set(
    rejected.map((line, index) => line.line_number ?? `#${index}`),
  ).size;
  const stored = inferStoredLines(
    serverReportedPartialWrite ? true : request.acceptPartial,
    rejectedCount,
    submitted,
  );
  const write: WriteOutcome | undefined =
    rejected.length === 0
      ? undefined
      : {
          ...(request.acceptPartial !== undefined && {
            accept_partial: request.acceptPartial,
          }),
          stored,
          stored_source: "inferred",
          lines_submitted: submitted,
          lines_rejected: rejectedCount,
          rejected_lines: rejected.slice(0, REJECTED_LINES_LIMIT),
          rejected_lines_truncated: rejected.length > REJECTED_LINES_LIMIT,
        };
  const fail = (code: string, recovery: Recovery, fix?: string) =>
    new WriteOperationError(
      message,
      code,
      recovery,
      status,
      retryAfter,
      fix,
      write,
      timeoutOrigin,
    );
  const resend =
    stored === "some"
      ? "Lines that aren't listed in write.rejected_lines were written; resend only the rejected lines."
      : stored === "none"
        ? "Nothing from this request was written; resend the whole batch."
        : "Check which lines were stored before resending.";

  if (status === 401) return fail("credential_invalid", "renew_credential");
  if (status === 403) {
    return fail(
      "not_found_or_denied",
      "none",
      "The token can't write to this database, or the database isn't visible to it. Don't retry with the same token.",
    );
  }
  if (status === 404) return fail("not_found", "none");
  const outcomeUnknown = (whatHappened: string) =>
    records.every(hasExplicitTimestamp)
      ? fail(
          "write_outcome_unknown",
          "retry",
          `${whatHappened}, so the write may or may not have been stored. Every line has a timestamp, so resending stores no second copy. Wait, then resend the same request a small number of times before reporting the failure.`,
        )
      : fail(
          "write_outcome_unknown",
          "none",
          `${whatHappened}, so the write may or may not have been stored. Lines without a timestamp get the server's time, so if the first attempt was stored, a resend writes a second point at a later time. Don't resend automatically: check whether the rows arrived, or ask the user.`,
        );
  if (
    status !== undefined &&
    STATUSES_WHERE_SERVER_REJECTED_THE_WRITE.includes(status)
  ) {
    return fail(
      "write_unavailable",
      "retry",
      "The server is temporarily refusing writes. Wait (retry_after_ms when present), then resend the same request a small number of times before reporting the failure.",
    );
  }
  if (
    status !== undefined &&
    STATUSES_WHERE_THE_WRITE_MAY_HAVE_BEEN_STORED.includes(status)
  ) {
    return outcomeUnknown("A gateway timed out waiting for the server");
  }
  const networkCode =
    status === undefined ? networkErrorCode(error) : undefined;
  if (networkCode === CONNECTION_REFUSED) {
    return fail(
      "write_connection_refused",
      "retry",
      "The server refused the connection, so nothing was written. It may be restarting: wait, then resend the same request a small number of times before reporting the failure.",
    );
  }
  if (networkCode === CONNECTION_RESET) {
    return outcomeUnknown("The connection closed before the server answered");
  }
  if (timeoutOrigin) {
    return outcomeUnknown("The client stopped waiting for the server's answer");
  }
  if (status === 413) {
    return fail(
      "write_too_large",
      "narrow",
      "Split the data into smaller batches and write them separately.",
    );
  }
  if (status === 500 && /must enable ingest mode/u.test(detail)) {
    return fail(
      "write_node_not_ingest",
      "change_endpoint",
      "INFLUX_DB_INSTANCE_URL points at a node that doesn't run ingest mode. Point it at an ingest node.",
    );
  }
  if (
    rejected.some((line) => /uses explicit schemas/u.test(line.error_message))
  ) {
    return fail(
      "write_schema_not_declared",
      "fix_reference",
      `The database uses explicit schemas. Check the table and column names with describe_table. If they're right, an operator must declare them (POST /api/v3/configure/table); this server has no tool for that. ${resend}`,
    );
  }
  if (rejected.length > 0) {
    return fail(
      "write_lines_rejected",
      "none",
      `Fix the rejected lines using each error_message. ${resend}`,
    );
  }
  return fail("write_failed", "none");
}
