import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolTelemetryEvent {
  tool_name: string;
  request_id: string;
  query_id?: string;
  timestamp_ms: number;
  duration_ms: number;
  db?: string;
  row_count?: number;
  truncated?: boolean;
  success: boolean;
  error_code?: string;
}

export function createRequestId(): string {
  return randomUUID();
}

let missingLogFileWarningEmitted = false;
let fileWriteWarningEmitted = false;

function serializeToolTelemetry(event: ToolTelemetryEvent): string {
  const sanitized: ToolTelemetryEvent = {
    tool_name: event.tool_name,
    request_id: event.request_id,
    query_id: event.query_id,
    timestamp_ms: event.timestamp_ms,
    duration_ms: event.duration_ms,
    db: event.db,
    row_count: event.row_count,
    truncated: event.truncated,
    success: event.success,
    error_code: event.error_code,
  };

  return JSON.stringify(sanitized);
}

function logToStderr(line: string): void {
  console.error(line);
}

function logToFile(line: string): boolean {
  const logFile = process.env.MCP_LOG_FILE;

  if (!logFile) {
    if (!missingLogFileWarningEmitted) {
      console.error(
        "[MCP] MCP_LOG_BACKEND=file requires MCP_LOG_FILE; falling back to stderr",
      );
      missingLogFileWarningEmitted = true;
    }
    return false;
  }

  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${line}\n`, "utf8");
    return true;
  } catch (error) {
    if (!fileWriteWarningEmitted) {
      console.error(
        `[MCP] Failed to write telemetry log file; falling back to stderr: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      fileWriteWarningEmitted = true;
    }
    return false;
  }
}

export function logToolCall(event: ToolTelemetryEvent): void {
  if (process.env.MCP_LOG_TOOL_CALLS === "false") {
    return;
  }

  const backend = process.env.MCP_LOG_BACKEND || "stderr";
  const line = serializeToolTelemetry(event);

  if (backend === "stdout") {
    console.log(line);
    return;
  }

  if (backend === "file" && logToFile(line)) {
    return;
  }

  logToStderr(line);
}
