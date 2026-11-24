import { RequestTimedOutError } from "@influxdata/influxdb3-client";
import { hasExplicitTimestamp, lineProtocolRecords } from "./line-protocol.js";

interface NormalizedError {
  status: number | undefined;
  body: unknown;
}

function normalizeError(error: any): NormalizedError {
  if (error?.response) {
    return { status: error.response.status, body: error.response.data };
  }
  if (typeof error?.statusCode === "number") {
    return { status: error.statusCode, body: error.json ?? error.body };
  }
  return { status: undefined, body: undefined };
}

function resolveErrorMessage(body: unknown, fallback: string): string {
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

function everyRejectedLine(body: unknown): RejectedLine[] {
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
 * `listed` is false when the message names no `line N:`, so the rejected
 * lines can't be told apart from the stored ones.
 */
function everyV2PartialWriteLine(
  error: any,
  body: unknown,
): { lines: RejectedLine[]; listed: boolean } {
  const none = { lines: [], listed: false };
  if (!body || typeof body !== "object") return none;
  const { message, line } = body as Record<string, unknown>;
  if (typeof message !== "string") return none;
  const prefix = V2_PARTIAL_WRITE_PREFIX.exec(message);
  const flagged = responseHeader(error, PARTIAL_WRITE_HEADER) === "true";
  if (!prefix && !flagged) return none;

  const lineErrors = prefix ? message.slice(prefix[0].length) : message;
  const markers = [...lineErrors.matchAll(V2_LINE_ERROR_MARKER)];
  if (markers.length === 0) {
    return {
      lines: [
        {
          error_message: lineErrors,
          ...(typeof line === "number" && { line_number: line }),
        },
      ],
      listed: false,
    };
  }
  const lines = markers.map((marker, index) => {
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
  return { lines, listed: true };
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

export interface OperationErrorOptions {
  recovery?: Recovery;
  status?: number;
  retryAfterMs?: number;
  timeoutOrigin?: "client";
  fix?: string;
  write?: WriteOutcome;
}

export class OperationError extends Error {
  readonly recovery: Recovery;
  readonly status?: number;
  readonly retry_after_ms?: number;
  readonly timeout_origin?: "client";
  readonly fix?: string;
  readonly write?: WriteOutcome;

  constructor(
    message: string,
    readonly code: string,
    private readonly options: OperationErrorOptions = {},
  ) {
    super(redactCredentials(message));
    this.recovery = options.recovery ?? "none";
    this.status = options.status;
    this.retry_after_ms = options.retryAfterMs;
    this.timeout_origin = options.timeoutOrigin;
    this.fix = options.fix;
    this.write = options.write;
  }

  withCode(code: string): OperationError {
    return new OperationError(this.message, code, this.options);
  }
}

const STATUS_LABEL: Partial<Record<number, string>> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Access denied or not found",
  404: "Not found",
  405: "Method not allowed",
  413: "Request entity too large",
  422: "Unprocessable entity",
  429: "Too many requests",
  503: "Service temporarily unavailable",
  504: "Gateway timeout",
};

const ACCESS_FAILURE_BY_STATUS: Partial<
  Record<number, { code: string; recovery: Recovery }>
> = {
  401: { code: "credential_invalid", recovery: "renew_credential" },
  403: { code: "not_found_or_denied", recovery: "none" },
  404: { code: "not_found", recovery: "none" },
};

interface SelfIdentifyingServerError {
  statuses: number[];
  pattern: RegExp;
  recovery: Recovery;
  replacementMessagePrefix?: string;
}

const coreUnknownFieldError: SelfIdentifyingServerError = {
  statuses: [500],
  pattern: /No field named/u,
  recovery: "fix_reference",
};

const unknownTablePlainTextError: SelfIdentifyingServerError = {
  statuses: [400],
  pattern: /Error during planning: table '[^']+' not found/u,
  recovery: "fix_reference",
};

const enterpriseIngestOnlyNodeError: SelfIdentifyingServerError = {
  statuses: [405],
  pattern: /send this query to a query node/u,
  recovery: "change_endpoint",
};

const queryMemoryPoolExhaustedError: SelfIdentifyingServerError = {
  statuses: [500, 429],
  pattern: /Resources exhausted/u,
  recovery: "narrow",
  replacementMessagePrefix:
    "Query ran out of server memory. Narrow the query (a shorter time range, fewer columns, or an aggregate) before running it again",
};

const SELF_IDENTIFYING_SERVER_ERRORS: SelfIdentifyingServerError[] = [
  coreUnknownFieldError,
  unknownTablePlainTextError,
  enterpriseIngestOnlyNodeError,
  queryMemoryPoolExhaustedError,
];

export function resolveOperationError(
  error: unknown,
  fallback = "query_failed",
): OperationError {
  if (error instanceof OperationError) {
    return fallback === "metadata_unavailable" && error.code === "query_failed"
      ? error.withCode(fallback)
      : error;
  }
  const { status, body } = normalizeError(error);
  const message = resolveErrorMessage(
    body,
    error instanceof Error ? error.message : "Operation failed",
  );
  const access =
    status === undefined ? undefined : ACCESS_FAILURE_BY_STATUS[status];
  const clientTimeout = clientStoppedWaiting(error);
  const code = access?.code ?? (clientTimeout ? "client_timeout" : fallback);
  const signature = SELF_IDENTIFYING_SERVER_ERRORS.find(
    (candidate) =>
      status !== undefined &&
      candidate.statuses.includes(status) &&
      candidate.pattern.test(message),
  );
  const recovery: Recovery = access?.recovery ?? signature?.recovery ?? "none";
  const label =
    (signature?.replacementMessagePrefix ??
      (status !== undefined && STATUS_LABEL[status])) ||
    "Query failed";
  return new OperationError(`${label}: ${message}`, code, {
    recovery,
    status,
    retryAfterMs: retryAfterMs(error),
    timeoutOrigin: clientTimeout ? "client" : undefined,
  });
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

function retryAfterMs(error: unknown): number | undefined {
  const value = responseHeader(error, "retry-after");
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

interface RejectedLines {
  lines: RejectedLine[];
  serverStoresValidLines: boolean;
}

function rejectedLinesOf(error: unknown, body: unknown): RejectedLines {
  const v3 = everyRejectedLine(body);
  if (v3.length > 0) return { lines: v3, serverStoresValidLines: false };
  const v2 = everyV2PartialWriteLine(error, body);
  return { lines: v2.lines, serverStoresValidLines: v2.listed };
}

function writeOutcome(
  rejected: RejectedLines,
  submitted: number,
  acceptPartial: boolean | undefined,
): WriteOutcome | undefined {
  const { lines } = rejected;
  if (lines.length === 0) return undefined;
  const rejectedCount = new Set(
    lines.map((line, index) => line.line_number ?? `#${index}`),
  ).size;
  return {
    ...(acceptPartial !== undefined && { accept_partial: acceptPartial }),
    stored: inferStoredLines(
      rejected.serverStoresValidLines ? true : acceptPartial,
      rejectedCount,
      submitted,
    ),
    stored_source: "inferred",
    lines_submitted: submitted,
    lines_rejected: rejectedCount,
    rejected_lines: lines.slice(0, REJECTED_LINES_LIMIT),
    rejected_lines_truncated: lines.length > REJECTED_LINES_LIMIT,
  };
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

export function resolveWriteError(
  error: any,
  database: string,
  request: { lineProtocol: string; acceptPartial?: boolean },
): OperationError {
  const { status, body } = normalizeError(error);
  const detail = resolveErrorMessage(
    body,
    typeof error?.message === "string" ? error.message : String(error),
  );
  const label = status !== undefined && STATUS_LABEL[status];
  const message = label
    ? `${label}: ${detail}`
    : `Failed to write data to database '${database}': ${detail}`;
  const retryAfter = retryAfterMs(error);
  const timeoutOrigin =
    status === undefined && clientStoppedWaiting(error) ? "client" : undefined;

  const records = lineProtocolRecords(request.lineProtocol);
  const rejected = rejectedLinesOf(error, body);
  const write = writeOutcome(rejected, records.length, request.acceptPartial);
  const stored = write?.stored ?? "unknown";
  const fail = (code: string, recovery: Recovery, fix?: string) =>
    new OperationError(message, code, {
      recovery,
      status,
      retryAfterMs: retryAfter,
      timeoutOrigin,
      fix,
      write,
    });
  const everyLineHasTimestamp = records.every(hasExplicitTimestamp);
  const resend =
    stored === "some" && write?.rejected_lines_truncated
      ? `write.rejected_lines lists ${write.rejected_lines.length} of the ${write.lines_rejected} rejected lines, so a line that isn't listed may have been written or rejected. Fix and resend the listed lines. Check which rows arrived before resending any unlisted lines.`
      : stored === "some"
        ? "Lines that aren't listed in write.rejected_lines were written; resend only the rejected lines."
        : stored === "none"
          ? "Nothing from this request was written; resend the whole batch."
          : "Check which lines were stored before resending.";

  const access =
    status === undefined ? undefined : ACCESS_FAILURE_BY_STATUS[status];
  if (access) {
    return fail(
      access.code,
      access.recovery,
      status === 403
        ? "The token can't write to this database, or the database isn't visible to it. Don't retry with the same token."
        : undefined,
    );
  }
  const outcomeUnknown = (whatHappened: string) =>
    everyLineHasTimestamp
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
    rejected.lines.some((line) =>
      /uses explicit schemas/u.test(line.error_message),
    )
  ) {
    return fail(
      "write_schema_not_declared",
      "fix_reference",
      `The database uses explicit schemas. Check the table and column names with describe_table. If they're right, an operator must declare them (POST /api/v3/configure/table); this server has no tool for that. ${resend}`,
    );
  }
  if (rejected.lines.length > 0) {
    return fail(
      "write_lines_rejected",
      "none",
      `Fix the rejected lines using each error_message. ${resend}`,
    );
  }
  return fail("write_failed", "none");
}
