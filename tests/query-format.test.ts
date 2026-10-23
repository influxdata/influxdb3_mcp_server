import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_INFLUXQL_CPU_TABLE,
  CORE_SQL_CPU_TABLE,
  CORE_SQL_CSV_RETURNS_JSON,
  CORE_SQL_FORMAT_MISMATCHES,
  CORE_SQL_SLOW,
  CPU_LINE_PROTOCOL,
  TRUST_DB,
} from "./fixtures/influxdb-scenarios.js";
import { Backend, LIVE, startBackend } from "./helpers/backend.js";
import {
  callTool,
  createTestClient,
  TestClient,
} from "./helpers/mcp-client.js";

const TIME_RANGE = "time >= '2024-03-09T16:00:00Z'";

/** Data records in a CSV payload, excluding the header line. */
function csvRecords(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .slice(1);
}

describe("read-only query formats and options on Core and Enterprise", () => {
  let backend: Backend;
  let mcp: TestClient;

  beforeAll(async () => {
    backend = await startBackend([
      CORE_SQL_CPU_TABLE,
      CORE_INFLUXQL_CPU_TABLE,
      CORE_SQL_CSV_RETURNS_JSON,
      ...CORE_SQL_FORMAT_MISMATCHES,
      CORE_SQL_SLOW,
    ]);
    await backend.seed(TRUST_DB, CPU_LINE_PROTOCOL);
    mcp = await createTestClient(backend.env);
  });

  afterAll(async () => {
    await mcp?.close();
    await backend?.close();
  });

  it("[both] returns capped CSV with the bound's records and a matching label", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE} ORDER BY time`,
      format: "csv",
      maxRows: 3,
    });

    expect(body.ok).toBe(true);
    expect(body.format).toBe("csv");
    expect(body.rows).toHaveLength(1);
    expect(csvRecords(body.rows[0].value)).toHaveLength(3);
    expect(body.metadata).toMatchObject({
      completeness: "capped",
      cap: 3,
      row_count: 3,
    });
  });

  it("[both] returns capped CSV from query_influxql the same way", async () => {
    const { body } = await callTool(mcp, "query_influxql", {
      db: TRUST_DB,
      q: `SELECT usage FROM cpu WHERE ${TIME_RANGE}`,
      format: "csv",
      maxRows: 3,
    });

    expect(body.ok).toBe(true);
    expect(body.format).toBe("csv");
    expect(csvRecords(body.rows[0].value)).toHaveLength(3);
    expect(body.metadata).toMatchObject({
      completeness: "capped",
      row_count: 3,
    });
  });

  it("[both] returns capped JSONL with one record per row", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE ${TIME_RANGE} ORDER BY time`,
      format: "jsonl",
      maxRows: 3,
    });

    expect(body.ok).toBe(true);
    expect(body.format).toBe("jsonl");
    const records = (body.rows[0].value as string)
      .split("\n")
      .filter((line) => line !== "");
    expect(records).toHaveLength(3);
    expect(() => records.map((line) => JSON.parse(line))).not.toThrow();
    expect(body.metadata).toMatchObject({
      completeness: "capped",
      row_count: 3,
    });
  });

  it.skipIf(LIVE)(
    "[fake-only: no product returns JSON for a CSV request on demand] labels JSON returned for a CSV request as JSON, with a warning (#84)",
    async () => {
      const { body } = await callTool(mcp, "query_sql", {
        db: TRUST_DB,
        q: `SELECT host, usage FROM cpu_json_only WHERE ${TIME_RANGE}`,
        format: "csv",
      });

      expect(body.ok).toBe(true);
      expect(body.format).toBe("json");
      expect(body.rows).toHaveLength(2);
      expect(body.rows[0]).toMatchObject({ host: "a" });
      expect(body.warnings).toContainEqual(
        expect.objectContaining({ code: "format_mismatch" }),
      );
    },
  );

  describe.skipIf(LIVE)("[fake-only: synthetic response media types]", () => {
    it.each([
      ["csv", "cpu_jsonl_only", "jsonl", '{"usage":1}\n'],
      ["json", "cpu_jsonl_only", "jsonl", '{"usage":1}\n'],
      ["jsonl", "cpu_csv_only", "csv", "usage\n1\n"],
      ["json", "cpu_csv_only", "csv", "usage\n1\n"],
    ])(
      "decodes requested %s from %s as %s",
      async (requested, table, returned, value) => {
        const { body } = await callTool(mcp, "query_sql", {
          db: TRUST_DB,
          q: `SELECT usage FROM ${table} WHERE ${TIME_RANGE}`,
          format: requested,
          maxRows: 1,
        });
        expect(body.ok).toBe(true);
        expect(body.format).toBe(returned);
        expect(body.rows).toEqual([{ value }]);
        expect(body.metadata).toMatchObject({
          completeness: "capped",
          cap: 1,
          cap_source: "server_bound",
          row_count: 1,
        });
        expect(body.warnings).toContainEqual(
          expect.objectContaining({ code: "format_mismatch" }),
        );
      },
    );
  });

  it.each(["query_sql", "query_influxql"])(
    "[both] %s refuses pretty before dispatch and names the supported formats",
    async (tool) => {
      const before = backend.fake?.requests.length;
      const { body, isError } = await callTool(mcp, tool, {
        db: TRUST_DB,
        q: `SELECT usage FROM cpu WHERE ${TIME_RANGE}`,
        format: "pretty",
      });

      expect(isError).toBe(true);
      expect(body.error.code).toBe("unsupported_query_format");
      expect(body.error.supported_formats).toEqual(["json", "jsonl", "csv"]);
      expect(backend.fake?.requests.length).toBe(before);
    },
  );

  it("[both] forwards query parameters to the server", async () => {
    const { body } = await callTool(mcp, "query_sql", {
      db: TRUST_DB,
      q: `SELECT host, usage FROM cpu WHERE host = $host AND ${TIME_RANGE}`,
      params: { host: "a" },
    });

    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(5);
    if (backend.fake) {
      const sent = backend.fake.requests.find((request) =>
        request.q?.includes("$host"),
      );
      expect((sent?.body as any)?.params).toEqual({ host: "a" });
    }
  });

  it.skipIf(LIVE)(
    "[fake-only: the testbench has no reliably slow query] gives up after timeoutMs instead of ignoring it",
    async () => {
      const started = Date.now();
      const { body } = await callTool(mcp, "query_sql", {
        db: TRUST_DB,
        q: `SELECT host, usage FROM cpu_slow WHERE ${TIME_RANGE}`,
        timeoutMs: 200,
      });

      expect(body.ok).toBe(false);
      expect(body.error.message).toMatch(/timeout/iu);
      expect(Date.now() - started).toBeLessThan(1_500);
    },
  );
});
