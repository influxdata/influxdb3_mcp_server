import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_SQL_CPU_TABLE,
  CORE_SQL_EMPTY_BODY,
  CORE_SQL_POOL_EXHAUSTED_DROP,
  CORE_SQL_POOL_EXHAUSTED_STATUS,
  CORE_SQL_UNKNOWN_TABLE,
  coreSqlInterrupted,
  CPU_LINE_PROTOCOL,
  Scenario,
  TRUST_DB,
} from "./fixtures/influxdb-scenarios.js";
import { Backend, LIVE, startBackend } from "./helpers/backend.js";
import { expectValidTelemetry } from "./helpers/envelope.js";
import {
  callTool,
  createTestClient,
  TestClient,
} from "./helpers/mcp-client.js";

const TIME_RANGE = "time >= '2024-03-09T16:00:00Z'";

describe("read-only query completeness", () => {
  let backend: Backend;
  let mcp: TestClient;

  beforeAll(async () => {
    backend = await startBackend([CORE_SQL_CPU_TABLE, CORE_SQL_UNKNOWN_TABLE]);
    await backend.seed(TRUST_DB, CPU_LINE_PROTOCOL);
    mcp = await createTestClient(backend.env);
  });

  afterAll(async () => {
    await mcp?.close();
    await backend?.close();
  });

  it("[both] reports a result cut by maxRows as capped by the server bound", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE}`,
      maxRows: 3,
    });

    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(3);
    expect(body.metadata).toMatchObject({
      completeness: "capped",
      cap: 3,
      cap_source: "server_bound",
      row_count: 3,
      truncated: true,
    });
  });

  it("[both] reports a result that fills the query's own LIMIT as possibly capped by that limit", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE} LIMIT 2`,
      maxRows: 10,
    });

    expect(body.rows).toHaveLength(2);
    expect(body.metadata).toMatchObject({
      completeness: "capped",
      cap: 2,
      cap_source: "query_limit",
      truncated: true,
    });
    expect(body.warnings).toContainEqual(
      expect.objectContaining({ code: "limit_reached" }),
    );
  });

  it.each([
    ["maxRows equals the row count", `WHERE ${TIME_RANGE}`, 5],
    [
      "the query's own LIMIT exceeds the row count",
      `WHERE ${TIME_RANGE} LIMIT 9`,
      10,
    ],
  ])(
    "[both] reports a complete result when %s",
    async (_case, clause, maxRows) => {
      const { body } = await callTool(mcp, "query_sql", {
        db: TRUST_DB,
        q: `SELECT host, usage FROM cpu ${clause}`,
        maxRows,
      });

      expect(body.rows).toHaveLength(5);
      expect(body.metadata).toMatchObject({
        completeness: "complete",
        row_count: 5,
        truncated: false,
      });
      expect(body.metadata).not.toHaveProperty("cap");
      expect(body.warnings).not.toContainEqual(
        expect.objectContaining({ code: "limit_reached" }),
      );
    },
  );

  it("[both] logs completeness and its cap source in telemetry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mcp-telemetry-"));
    const log = join(directory, "telemetry.jsonl");
    const client = await createTestClient({
      ...backend.env,
      MCP_LOG_TOOL_CALLS: "true",
      MCP_LOG_BACKEND: "file",
      MCP_LOG_FILE: log,
    });
    try {
      await callTool(client, "query_sql", {
        db: TRUST_DB,
        q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE} LIMIT 2`,
        maxRows: 10,
      });
      const [event] = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(event).toMatchObject({
        tool_name: "query_sql",
        row_count: 2,
        completeness: "capped",
        cap_source: "query_limit",
      });
      expect(event).not.toHaveProperty("truncated");
      expectValidTelemetry(event);
    } finally {
      await client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("[both] echoes the bound the caller sees, not the probe row", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE}`,
      maxRows: 3,
    });

    expect(body.q).toMatch(/LIMIT 3$/u);
  });

  it("[both] returns a failure before the first row as an error with no rows", async () => {
    const { body, isError } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT * FROM no_such_table WHERE ${TIME_RANGE}`,
    });

    expect(isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body).not.toHaveProperty("rows");
    expect(body.metadata).toMatchObject({ row_count: 0 });
    expect(body.metadata.completeness).not.toBe("complete");
  });

  describe.skipIf(LIVE)(
    "[fake-only: the testbench cannot fail a stream on demand]",
    () => {
      it.each(["truncate", "abort"] as const)(
        "returns a response that stops after two rows (%s) as interrupted, with those rows",
        async (mode) => {
          await expectInterruptedAfterTwoRows(mode);
        },
      );

      it.for(["json", "jsonl", "csv"] as const)(
        "returns a connection dropped before the first row (%s) as interrupted with no rows",
        async (format) => {
          await expectInterruptedWithNoRows(
            CORE_SQL_POOL_EXHAUSTED_DROP,
            "cpu_pool_exhausted",
            format,
          );
        },
      );

      it("returns a memory failure status before the first row as a failed query with the server's reason", async () => {
        const fake = await startBackend([CORE_SQL_POOL_EXHAUSTED_STATUS]);
        const client = await createTestClient(fake.env);
        try {
          const { body, isError } = await callTool(client, "query_sql", {
            db: TRUST_DB,
            q: `SELECT host, usage FROM cpu_pool_exhausted_status WHERE ${TIME_RANGE}`,
          });

          expect(isError).toBe(true);
          expect(body.ok).toBe(false);
          expect(body).not.toHaveProperty("rows");
          expect(body.metadata).toMatchObject({ row_count: 0 });
          expect(body.error.code).not.toBe("query_interrupted");
          expect(body.error.message).toContain("Resources exhausted");
        } finally {
          await client.close();
          await fake.close();
        }
      });

      it("returns a 200 with an empty body as interrupted, not as no rows", async () => {
        await expectInterruptedWithNoRows(
          CORE_SQL_EMPTY_BODY,
          "cpu_empty_body",
          "json",
        );
      });
    },
  );
});

async function expectInterruptedWithNoRows(
  scenario: Scenario,
  table: string,
  format: "json" | "jsonl" | "csv",
): Promise<void> {
  const fake = await startBackend([scenario]);
  const client = await createTestClient(fake.env);
  try {
    const { body, isError } = await callTool(client, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM ${table} WHERE ${TIME_RANGE}`,
      format,
    });

    expect(isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.rows ?? []).toHaveLength(0);
    expect(body.metadata).toMatchObject({
      completeness: "interrupted",
      row_count: 0,
      truncated: true,
    });
    expect(body.error.code).toBe("query_interrupted");
  } finally {
    await client.close();
    await fake.close();
  }
}

async function expectInterruptedAfterTwoRows(
  mode: "truncate" | "abort",
): Promise<void> {
  const fake = await startBackend([coreSqlInterrupted(mode)]);
  const client = await createTestClient(fake.env);
  try {
    const { body, isError } = await callTool(client, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu_stream_fail WHERE ${TIME_RANGE}`,
    });

    expect(isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.rows).toHaveLength(2);
    expect(body.metadata).toMatchObject({
      completeness: "interrupted",
      row_count: 2,
      truncated: true,
    });
    expect(body.error.code).toBe("query_interrupted");
  } finally {
    await client.close();
    await fake.close();
  }
}
