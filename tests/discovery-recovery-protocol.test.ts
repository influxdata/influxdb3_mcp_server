import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestClient, type TestClient } from "./helpers/mcp-client.js";
import { FakeInfluxDB, startFakeInfluxDB } from "./helpers/fake-influxdb.js";
import {
  ACCESS_OUTCOMES,
  accessScenariosFor,
  DISCOVERY_SCENARIOS,
  INGEST_NODE_QUERY,
  RECOVERY_SCENARIOS,
  SAMPLES_DENIED_OR_EMPTY,
  TOKEN_ECHO,
} from "./fixtures/discovery-scenarios.js";
import {
  CORE_SQL_SLOW,
  Scenario,
  TRUST_DB,
} from "./fixtures/influxdb-scenarios.js";
import {
  expectValidEnvelope,
  expectValidTelemetry,
} from "./helpers/envelope.js";

const live = ["true", "1"].includes(process.env.INFLUX_TEST_ENABLED || "");
let session: TestClient | undefined;
let fake: FakeInfluxDB | undefined;
let logDir: string | undefined;
async function connect(scenarios: Scenario[] = DISCOVERY_SCENARIOS) {
  fake = await startFakeInfluxDB(scenarios);
  logDir = mkdtempSync(join(tmpdir(), "mcp-discovery-"));
  session = await createTestClient({
    INFLUX_DB_INSTANCE_URL: fake.url,
    INFLUX_MCP_TOOL_PROFILE: "readonly",
    MCP_LOG_BACKEND: "file",
    MCP_LOG_FILE: join(logDir, "calls.jsonl"),
  });
  return session.client;
}
function payload(
  result: Awaited<
    ReturnType<NonNullable<typeof session>["client"]["callTool"]>
  >,
) {
  const content = result.content;
  if (!Array.isArray(content)) throw new Error("Missing content");
  const first = content[0];
  if (first.type !== "text") throw new Error("Expected text");
  const resultPayload = JSON.parse(first.text);
  expectValidEnvelope(resultPayload);
  return resultPayload;
}
afterEach(async () => {
  await session?.close();
  await fake?.close();
  if (logDir) rmSync(logDir, { recursive: true, force: true });
  session = undefined;
  fake = undefined;
  logDir = undefined;
});

describe.skipIf(live)(
  "[fake-only] discovery/recovery protocol, scripted access states need fixtures on live targets",
  () => {
    for (const scenario of ACCESS_OUTCOMES) {
      it(`preserves ${scenario.name} on queries and discovery`, async () => {
        const client = await connect(accessScenariosFor(scenario.status));
        for (const name of [
          "query_sql",
          "query_influxql",
          "list_tables",
          "describe_table",
          "investigate_database",
          "list_databases",
        ]) {
          const result = payload(
            await client.callTool({
              name,
              arguments:
                name === "list_databases"
                  ? {}
                  : {
                      db: "smoke",
                      ...(name.startsWith("query_")
                        ? { q: "SELECT * FROM metrics LIMIT 1" }
                        : {}),
                      ...(name === "describe_table"
                        ? { table: "metrics" }
                        : {}),
                    },
            }),
          );
          expect(result.ok).toBe(false);
          expect(result.error).toMatchObject({
            code: scenario.code,
            recovery: scenario.recovery,
            retryable: false,
          });
        }
      });
    }
    it("passes the server's error text through with the token redacted", async () => {
      const client = await connect([TOKEN_ECHO]);
      const result = payload(
        await client.callTool({
          name: "query_sql",
          arguments: { db: "smoke", q: "SELECT 1" },
        }),
      );
      expect(result.error.message).toContain("is not valid");
      expect(JSON.stringify(result)).not.toContain("test-token-not-used");
    });
    it("reports denied health as reachable and unconfirmed", async () => {
      const client = await connect(accessScenariosFor(403));
      const result = payload(
        await client.callTool({ name: "health_check", arguments: {} }),
      );
      expect(result.connection.status).toBe("unknown");
      expect(result.connection.reachable).toBe(true);
      expect(result.health.outcome).toBe("credential_cannot_check");
      expect(result.ping.outcome).toBe("credential_cannot_check");
      const status = await client.readResource({ uri: "influx://status" });
      const [content] = status.contents;
      if (!("text" in content)) throw new Error("Expected text");
      expect(JSON.parse(content.text).overall.status).toBe("unknown");
    });
    it("keeps successful tables, stable truncation, recent bounded samples, and warnings", async () => {
      const client = await connect();
      const result = payload(
        await client.callTool({
          name: "investigate_database",
          arguments: {
            db: "smoke",
            includeSamples: true,
            maxTables: 3,
            sampleRowsPerTable: 2,
            sampleWindowHours: 48,
          },
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        table_total: 4,
        table_count: 3,
        tables_truncated: true,
        tables_failed: 1,
        sample_window: { hours: 48 },
      });
      expect(result.tables.map((t: { name: string }) => t.name)).toEqual([
        "alpha",
        "beta",
        "metrics-1720000000",
      ]);
      expect(result.tables[0]).toMatchObject({
        status: "ok",
        samples: [{ value: 2, time: "2026-10-15T00:00:00Z" }],
      });
      expect(result.tables[1]).toMatchObject({
        status: "failed",
        error: { code: "not_found_or_denied" },
      });
      expect(result.tables[2].deletion).toEqual({
        value: "unknown",
        source: "unknown",
      });
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "possibly_deleted" }),
        ]),
      );
      const sampleQueries = fake!.requests.filter((r) =>
        r.q?.startsWith("SELECT * FROM"),
      );
      expect(sampleQueries).toHaveLength(2);
      // A sample of 2 asks for one row more, to tell whether it was capped.
      for (const request of sampleQueries) {
        expect(request.q).toMatch(
          /WHERE time >= '.*' AND time <= '.*' ORDER BY time DESC LIMIT 3$/,
        );
      }
      expect(result.query_budget.used).toBeLessThanOrEqual(
        result.query_budget.max,
      );
    });
    it("distinguishes empty discovery and refuses cardinality", async () => {
      const client = await connect();
      expect(
        payload(
          await client.callTool({
            name: "list_tables",
            arguments: { db: "empty" },
          }),
        ),
      ).toMatchObject({ ok: true, access_outcome: "empty" });
      expect(
        payload(
          await client.callTool({
            name: "investigate_database",
            arguments: { db: "smoke", includeCardinality: true },
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: "unsupported_option" } });
    });
    it("accepts both alias pairs and logs validation failures once", async () => {
      const client = await connect();
      for (const name of ["query_sql", "query_influxql"]) {
        expect(
          payload(
            await client.callTool({
              name,
              arguments: {
                database: "smoke",
                query: "SELECT * FROM metrics LIMIT 1",
              },
            }),
          ).ok,
        ).toBe(true);
        for (const args of [
          { db: "smoke" },
          { db: "smoke", database: "other", q: "SELECT 1" },
          { db: "smoke", q: "SELECT 1", query: "SELECT 2" },
          { db: "smoke", q: "SELECT 1", surprise: true },
        ]) {
          expect(
            payload(await client.callTool({ name, arguments: args })),
          ).toMatchObject({
            ok: false,
            error: { code: "invalid_arguments", recovery: "none" },
          });
        }
      }
      const events = readFileSync(join(logDir!, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events).toHaveLength(10);
      events.forEach(expectValidTelemetry);
      expect(
        events.filter((e) => e.error_code === "invalid_arguments"),
      ).toHaveLength(8);
    });
    for (const scenario of RECOVERY_SCENARIOS) {
      const response = scenario.response as {
        status: number;
        headers?: Record<string, string>;
      };
      it(`preserves ${scenario.name} without inventing a recovery classification`, async () => {
        const client = await connect([scenario]);
        const result = payload(
          await client.callTool({
            name: "query_sql",
            arguments: { db: "smoke", q: "SELECT 1" },
          }),
        );
        expect(result.error).toMatchObject({
          recovery: "none",
          retryable: false,
          status: response.status,
        });
        if (response.headers?.["retry-after"])
          expect(result.error.retry_after_ms).toBe(2000);
        else expect(result.error.retry_after_ms).toBeUndefined();
      });
    }
    it("tells the caller to send a query for an ingest-only node to a query node", async () => {
      const client = await connect([INGEST_NODE_QUERY]);
      const result = payload(
        await client.callTool({
          name: "query_sql",
          arguments: { db: "smoke", q: "SELECT 1" },
        }),
      );
      expect(result.error).toMatchObject({
        status: 405,
        recovery: "change_endpoint",
        retryable: false,
      });
      expect(result.error.message).toContain("send this query to a query node");
    });
    it("does not let a denied database poison successful discovery", async () => {
      const client = await connect();
      const databases = payload(
        await client.callTool({ name: "list_databases", arguments: {} }),
      );
      expect(databases.visibility).toBe("unknown");
      const outcomes: string[] = [];
      for (const database of databases.databases) {
        const result = payload(
          await client.callTool({
            name: "list_tables",
            arguments: { db: database.name },
          }),
        );
        outcomes.push(result.access_outcome ?? result.error.access_outcome);
      }
      expect(outcomes).toEqual(["data", "not_found_or_denied", "empty"]);
    });
    it("keeps schema when sampling is denied and labels an empty window accurately", async () => {
      const client = await connect([
        ...SAMPLES_DENIED_OR_EMPTY,
        ...DISCOVERY_SCENARIOS,
      ]);
      const result = payload(
        await client.callTool({
          name: "investigate_database",
          arguments: { db: "smoke", includeSamples: true },
        }),
      );
      expect(result.tables[0]).toMatchObject({
        status: "partial",
        schema: { columns: expect.any(Array) },
        error: { code: "not_found_or_denied" },
      });
      expect(result.tables[2]).toMatchObject({
        status: "ok",
        sample_outcome: "no_rows_in_window",
      });
      expect(result.query_budget.used).toBeGreaterThanOrEqual(
        fake!.requests.length,
      );
    });
    it("runs EXPLAIN ANALYZE through query bounds and labels execution", async () => {
      const client = await connect();
      const result = payload(
        await client.callTool({
          name: "query_sql",
          arguments: {
            db: "smoke",
            q: "EXPLAIN ANALYZE SELECT * FROM metrics",
            maxRows: 2,
          },
        }),
      );
      expect(result.ok).toBe(true);
      expect(result.q).toMatch(/EXPLAIN ANALYZE .* LIMIT 2$/);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "diagnostic_execution" }),
      );
    });
    it("distinguishes an actual HTTP client timeout from a server HTTP timeout response", async () => {
      const client = await connect([CORE_SQL_SLOW]);
      const result = payload(
        await client.callTool({
          name: "query_sql",
          arguments: {
            db: TRUST_DB,
            q: "SELECT host FROM cpu_slow",
            timeoutMs: 10,
          },
        }),
      );
      expect(result.error).toMatchObject({
        code: "client_timeout",
        timeout_origin: "client",
        recovery: "none",
        retryable: false,
      });
      expect(result.error.status).toBeUndefined();
    });
  },
);

describe.skip("[P2] live-only Enterprise 3.12.1 JWT, blocked on user authentication in testbench compose", () => {
  it("distinguishes permitted, denied and expired JWT reads", () => {});
});
describe.skip("[P3] live-only 3.12.1 metadata and isolated tombstone fixture not configured", () => {
  it("records authoritative column roles, schema mode and deletion provenance", () => {});
});
describe.skip("[P4] live-only exhaustion/wrong-node mapping, blocked on recorded 3.12.1 responses", () => {
  it("records exhaustion, queue timeout and ingest-only 405 bodies before classifying recovery", () => {});
});
