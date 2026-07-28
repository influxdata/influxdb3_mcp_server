import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logToolCall } from "../src/services/telemetry.service.js";

const BASE_EVENT = {
  tool_name: "query_sql",
  request_id: "request-1",
  query_id: "query-1",
  timestamp_ms: 1710000000000,
  duration_ms: 42,
  db: "host_system",
  row_count: 3,
  truncated: false,
  success: true,
};

describe("telemetry logging", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "influxdb-mcp-telemetry-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.MCP_LOG_TOOL_CALLS;
    delete process.env.MCP_LOG_BACKEND;
    delete process.env.MCP_LOG_FILE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MCP_LOG_TOOL_CALLS;
    delete process.env.MCP_LOG_BACKEND;
    delete process.env.MCP_LOG_FILE;
  });

  it("writes valid JSONL when the file backend is configured", () => {
    const logFile = join(tempDir, "nested", "telemetry.jsonl");
    process.env.MCP_LOG_BACKEND = "file";
    process.env.MCP_LOG_FILE = logFile;

    logToolCall(BASE_EVENT);

    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(BASE_EVENT);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("falls back to stderr when file backend is missing MCP_LOG_FILE", () => {
    process.env.MCP_LOG_BACKEND = "file";

    logToolCall(BASE_EVENT);

    expect(console.error).toHaveBeenCalledWith(
      "[MCP] MCP_LOG_BACKEND=file requires MCP_LOG_FILE; falling back to stderr",
    );
    expect(console.error).toHaveBeenCalledWith(JSON.stringify(BASE_EVENT));
  });

  it("suppresses telemetry when MCP_LOG_TOOL_CALLS is false", () => {
    process.env.MCP_LOG_TOOL_CALLS = "false";
    process.env.MCP_LOG_BACKEND = "file";
    process.env.MCP_LOG_FILE = join(tempDir, "telemetry.jsonl");

    logToolCall(BASE_EVENT);

    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("does not log tokens, headers, tool arguments, or query text", () => {
    const logFile = join(tempDir, "telemetry.jsonl");
    process.env.MCP_LOG_BACKEND = "file";
    process.env.MCP_LOG_FILE = logFile;

    logToolCall({
      ...BASE_EVENT,
      token: "fake-token-should-not-log",
      headers: { Authorization: "Bearer should-not-log" },
      arguments: { q: "select * from secret_measurement" },
      query_text: "select * from secret_measurement",
    } as any);

    const line = readFileSync(logFile, "utf8").trim();
    expect(line).not.toContain("apiv3_");
    expect(line).not.toContain("Authorization");
    expect(line).not.toContain("secret_measurement");
    expect(JSON.parse(line)).toEqual(BASE_EVENT);
  });
});
