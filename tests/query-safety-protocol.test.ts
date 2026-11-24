import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_SQL_CPU_TABLE,
  CPU_LINE_PROTOCOL,
  TRUST_DB,
} from "./fixtures/influxdb-scenarios.js";
import { Backend, startBackend } from "./helpers/backend.js";
import {
  callTool,
  createTestClient,
  TestClient,
} from "./helpers/mcp-client.js";

describe("read-only query safety over MCP, end to end like the ro-quoted-keyword testbench case", () => {
  let backend: Backend;
  let mcp: TestClient;

  beforeAll(async () => {
    backend = await startBackend([CORE_SQL_CPU_TABLE]);
    await backend.seed(TRUST_DB, CPU_LINE_PROTOCOL);
    mcp = await createTestClient(backend.env);
  });

  afterAll(async () => {
    await mcp?.close();
    await backend?.close();
  });

  it("[both] runs a query whose string literal contains DROP", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: "SELECT 'DROP TABLE metrics' AS note, usage FROM cpu WHERE time >= '2024-03-09T16:00:00Z'",
    });

    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(5);
  });
});
