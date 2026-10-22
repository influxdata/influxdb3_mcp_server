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
  ENTERPRISE_SQL_MEMORY_EXHAUSTED,
  INGEST_NODE_QUERY,
  JWT_DENIED_DB,
  JWT_MISSING_DB,
  JWT_SCENARIOS,
  RECOVERY_SCENARIOS,
  SAMPLES_DENIED_OR_EMPTY,
  TOKEN_ECHO,
} from "./fixtures/discovery-scenarios.js";
import {
  CORE_SQL_POOL_EXHAUSTED_STATUS,
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
          // An empty error body must not leave an empty message.
          expect(result.error.message).toMatch(/: \S/u);
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
      for (const request of sampleQueries) {
        expect(request.q).toMatch(
          /WHERE time >= '.*' AND time <= '.*' ORDER BY time DESC LIMIT 2/,
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
    it.for([
      ["Core 500", CORE_SQL_POOL_EXHAUSTED_STATUS, "cpu_pool_exhausted_status"],
      ["Enterprise 429", ENTERPRISE_SQL_MEMORY_EXHAUSTED, "cpu"],
    ] as const)(
      "asks the caller to narrow a query that ran out of memory (%s)",
      async ([, scenario, table]) => {
        const client = await connect([scenario]);
        const result = payload(
          await client.callTool({
            name: "query_sql",
            arguments: {
              db: TRUST_DB,
              q: `SELECT host FROM ${table} WHERE time > now() - interval '1 hour'`,
            },
          }),
        );
        expect(result.error).toMatchObject({
          recovery: "narrow",
          retryable: false,
        });
        expect(result.error.message).toContain("Narrow the query");
        expect(result.error.message).toContain("Resources exhausted");
      },
    );
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
      // The server runs the diagnostic, bounded with the one-row probe.
      expect(fake!.requests.map((r) => r.q)).toContain(
        "EXPLAIN ANALYZE SELECT * FROM metrics LIMIT 3",
      );
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

// Live Enterprise user JWTs. Each case runs only when its variable is set,
// so the testbench runner can supply any subset. The smoke-reader role needs
// --rbac-authoring-disabled=false, which 3.12.1 does not list in
// serve --help-all: report a failure there as a preview, not a regression.
const JWT_DB = process.env.INFLUX_TEST_DATABASE || "smoke";
const jwtCases = [
  { role: "member", env: "INFLUX_TEST_JWT_MEMBER" },
  { role: "auditor", env: "INFLUX_TEST_JWT_AUDITOR" },
  { role: "smoke-reader (preview)", env: "INFLUX_TEST_JWT_SMOKE" },
] as const;
describe.skipIf(!live)("[live-only] Enterprise 3.12.1 user JWT reads", () => {
  async function connectJwt(token: string) {
    session = await createTestClient({
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL!,
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_DB_TOKEN: token,
      INFLUX_MCP_TOOL_PROFILE: "readonly",
    });
    return session.client;
  }
  for (const { role, env } of jwtCases) {
    it.skipIf(!process.env[env])(`${role}: ${env}`, async () => {
      const client = await connectJwt(process.env[env]!);
      const call = async (name: string, args: Record<string, unknown>) =>
        payload(await client.callTool({ name, arguments: args }));
      const health = await call("health_check", {});
      expect(health.connection.reachable).toBe(true);
      expect(health.health.outcome).toBe("credential_cannot_check");
      expect(health.ping.outcome).toBe("credential_cannot_check");

      const databases = await call("list_databases", {});
      expect(databases.ok).toBe(true);
      const names = databases.databases.map((d: any) => d.name);
      if (env === "INFLUX_TEST_JWT_SMOKE") expect(names).toEqual([JWT_DB]);
      else expect(names).toContain(JWT_DB);

      const tables = await call("list_tables", { db: JWT_DB });
      const query = await call("query_sql", {
        db: JWT_DB,
        q: "SELECT * FROM seed_marker LIMIT 1",
      });
      if (env === "INFLUX_TEST_JWT_AUDITOR") {
        // Auditor lists databases but cannot query, and list_tables queries.
        for (const result of [tables, query]) {
          expect(result.ok).toBe(false);
          expect(result.error).toMatchObject({
            code: "not_found_or_denied",
            status: 403,
            recovery: "none",
          });
        }
      } else {
        expect(tables.ok).toBe(true);
        expect(query.ok).toBe(true);
        expect(query.rows).toHaveLength(1);
      }
    });
  }
  it.skipIf(!process.env.INFLUX_TEST_JWT_EXPIRED)(
    "expired: INFLUX_TEST_JWT_EXPIRED",
    async () => {
      const client = await connectJwt(process.env.INFLUX_TEST_JWT_EXPIRED!);
      const result = payload(
        await client.callTool({
          name: "query_sql",
          arguments: { db: JWT_DB, q: "SELECT 1" },
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "credential_invalid",
        access_outcome: "credential_invalid",
        recovery: "renew_credential",
        retryable: false,
        status: 401,
      });
    },
  );
});
describe.skipIf(live)("[fake-only] Enterprise 3.12.1 JWT responses", () => {
  const query = (db: string) => ({
    name: "query_sql",
    arguments: { db, q: "SELECT 1" },
  });
  it("classifies an Auditor denial as not found or denied, with no recovery", async () => {
    const client = await connect([JWT_SCENARIOS.auditorDenied]);
    for (const name of ["query_sql", "list_tables"]) {
      const result = payload(
        await client.callTool({
          name,
          arguments: {
            db: "smoke",
            ...(name === "query_sql" && { q: "SELECT 1" }),
          },
        }),
      );
      expect(result.error).toMatchObject({
        code: "not_found_or_denied",
        status: 403,
        recovery: "none",
      });
    }
  });
  it("answers a denied database and a missing one alike", async () => {
    const client = await connect([
      JWT_SCENARIOS.deniedDatabase,
      JWT_SCENARIOS.missingDatabase,
    ]);
    const errors = [];
    for (const db of [JWT_DENIED_DB, JWT_MISSING_DB]) {
      errors.push(payload(await client.callTool(query(db))).error);
    }
    expect(errors[0]).toMatchObject({
      code: "not_found_or_denied",
      status: 403,
      recovery: "none",
    });
    expect(errors[0].message).toBe(errors[1].message);
    expect(errors[0].code).toBe(errors[1].code);
  });
  // The body does not say whether the JWT expired, is malformed, or went to
  // a node that does not accept it, so all three stay credential_invalid.
  for (const key of ["expired", "malformed", "wrongNode"] as const) {
    it(`keeps a 401 for a ${key} JWT as credential_invalid`, async () => {
      const client = await connect([JWT_SCENARIOS[key]]);
      const result = payload(await client.callTool(query(JWT_DB)));
      expect(result.error).toMatchObject({
        code: "credential_invalid",
        access_outcome: "credential_invalid",
        recovery: "renew_credential",
        retryable: false,
        status: 401,
        message: "Unauthorized: the request was not authenticated",
      });
    });
  }
});
// P3's isolated Core/Enterprise metadata and tombstone cases run in
// p3-metadata-live.test.ts, with app and admin credentials kept separate.
describe.skip("[P4] live-only server timeout and backpressure, not yet observed on 3.12.1", () => {
  it("records server-timeout and Retry-After backpressure bodies before classifying recovery", () => {});
});
