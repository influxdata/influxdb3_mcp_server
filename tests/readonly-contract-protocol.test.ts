import { afterEach, expect, it } from "vitest";
import { Ajv } from "ajv";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestClient, type TestClient } from "./helpers/mcp-client.js";
import { startFakeInflux } from "./helpers/fake-influxdb.js";
import { discoveryReply } from "./fixtures/discovery-scenarios.js";
import { assertEnvelope, assertTelemetry } from "./helpers/contracts.js";

const live = ["1", "true"].includes(process.env.INFLUX_TEST_ENABLED || "");
let session: TestClient | undefined;
let fake: Awaited<ReturnType<typeof startFakeInflux>> | undefined;
let directory: string | undefined;
afterEach(async () => {
  await session?.close();
  await fake?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("[both] every readonly tool agrees on inputs and writes one telemetry event per successful or invalid call", async () => {
  directory = mkdtempSync(join(tmpdir(), "mcp-contract-"));
  const log = join(directory, "telemetry.jsonl");
  const env: Record<string, string> = {
    INFLUX_MCP_TOOL_PROFILE: "readonly",
    MCP_LOG_BACKEND: "file",
    MCP_LOG_FILE: log,
  };
  if (live) {
    for (const key of [
      "INFLUX_DB_INSTANCE_URL",
      "INFLUX_DB_PRODUCT_TYPE",
      "INFLUX_DB_TOKEN",
    ]) {
      const value = process.env[key];
      if (!value) throw new Error(`Live contract requires ${key}`);
      env[key] = value;
    }
  } else {
    fake = await startFakeInflux(discoveryReply);
    env.INFLUX_DB_INSTANCE_URL = fake.url;
  }
  session = await createTestClient(env);
  const client = session.client;
  let callCount = 0;
  async function call(name: string, args: Record<string, unknown>) {
    callCount++;
    const result = await client.callTool({ name, arguments: args });
    const content = result.content;
    if (!Array.isArray(content) || content[0].type !== "text")
      throw new Error("Expected text response");
    return { result, text: content[0].text };
  }
  const db = live ? process.env.INFLUX_TEST_DATABASE || "smoke" : "smoke";
  const discovered = await call("list_tables", { db });
  const discovery = JSON.parse(discovered.text);
  assertEnvelope(discovery);
  expect(discovery.ok).toBe(true);
  expect(
    discovery.tables.length,
    "Seed a readable table in INFLUX_TEST_DATABASE",
  ).toBeGreaterThan(0);
  const table = discovery.tables[0].name;
  const q = `SELECT * FROM "${table.replace(/"/gu, '""')}" LIMIT 1`;
  const argsByTool: Record<string, Record<string, unknown>> = {
    query_sql: { db, q },
    query_influxql: { db, q },
    list_tables: { db },
    describe_table: { db, table },
    investigate_database: {
      db,
      maxTables: 1,
      includeSamples: true,
      sampleRowsPerTable: 1,
    },
    list_databases: {},
    health_check: {},
    get_help: {},
    load_database_context: {},
  };
  const ajv = new Ajv({ strict: false });
  for (const tool of (await client.listTools()).tools) {
    const args = argsByTool[tool.name];
    expect(args, `Add contract arguments for ${tool.name}`).toBeDefined();
    const validate = ajv.compile(tool.inputSchema);
    expect(validate(args), JSON.stringify(validate.errors)).toBe(true);
    const success = await call(tool.name, args);
    expect(success.result.isError, tool.name).not.toBe(true);
    if (!["get_help", "load_database_context"].includes(tool.name))
      assertEnvelope(JSON.parse(success.text));
    if (tool.name === "investigate_database") {
      const investigation = JSON.parse(success.text);
      expect(investigation.sample_window.hours).toBe(24);
      expect(investigation.table_count).toBe(1);
      expect(investigation.tables_truncated).toBe(
        investigation.table_total > 1,
      );
      expect(investigation.query_budget.used).toBeLessThanOrEqual(
        investigation.query_budget.max,
      );
    }
    const unexpected = { ...args, unexpected_argument: true };
    expect(validate(unexpected)).toBe(false);
    const invalid = await call(tool.name, unexpected);
    const failure = JSON.parse(invalid.text);
    assertEnvelope(failure);
    expect(invalid.result.isError).toBe(true);
    expect(failure.error.code).toBe("invalid_arguments");
    for (const required of tool.inputSchema.required || []) {
      const missing = { ...args };
      delete missing[required];
      expect(validate(missing)).toBe(false);
      const rejected = JSON.parse((await call(tool.name, missing)).text);
      assertEnvelope(rejected);
      expect(rejected.error.code).toBe("invalid_arguments");
    }
  }
  const events = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events).toHaveLength(callCount);
  events.forEach(assertTelemetry);
  expect(new Set(events.map((event) => event.request_id)).size).toBe(callCount);
  const secret = env.INFLUX_DB_TOKEN || "test-token-not-used";
  expect(JSON.stringify(events)).not.toContain(secret);
});
