import { randomUUID } from "node:crypto";

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

export function logToolCall(event: ToolTelemetryEvent): void {
  if (process.env.MCP_LOG_TOOL_CALLS === "false") {
    return;
  }

  const backend = process.env.MCP_LOG_BACKEND || "stderr";
  const line = JSON.stringify(event);

  if (backend === "stdout") {
    console.log(line);
    return;
  }

  console.error(line);
}
