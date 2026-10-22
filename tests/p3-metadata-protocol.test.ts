import { afterEach, describe, expect, it } from "vitest";
import {
  callTool,
  createTestClient,
  type TestClient,
} from "./helpers/mcp-client.js";
import {
  startFakeInfluxDB,
  type FakeInfluxDB,
} from "./helpers/fake-influxdb.js";
import { P3_METADATA_SCENARIOS } from "./fixtures/p3-metadata-scenarios.js";
import { DISCOVERY_SCENARIOS } from "./fixtures/discovery-scenarios.js";
import type { Scenario } from "./fixtures/influxdb-scenarios.js";

let fake: FakeInfluxDB;
let client: TestClient;
afterEach(async () => {
  await client?.close();
  await fake?.close();
});

async function connect(overrides: Scenario[] = []) {
  fake = await startFakeInfluxDB([
    ...overrides,
    ...P3_METADATA_SCENARIOS,
    ...DISCOVERY_SCENARIOS,
  ]);
  client = await createTestClient({
    INFLUX_DB_INSTANCE_URL: fake.url,
    INFLUX_MCP_TOOL_PROFILE: "readonly",
  });
}

describe("P3 metadata protocol", () => {
  it("uses observed roles, binds catalog references, and overrides a name-only deletion warning", async () => {
    await connect();
    const table = "metrics-20260101T000000";
    const { body } = await callTool(client, "describe_table", {
      db: "smoke",
      table,
    });
    expect(body.schema_mode).toEqual({
      value: "implicit",
      source: "server",
      catalog: "system.databases",
    });
    expect(body.deletion).toEqual({
      value: false,
      source: "server",
      catalog: "system.tables",
    });
    expect(body.columns).toContainEqual(
      expect.objectContaining({
        name: "host",
        category: "tag",
        source: "server",
      }),
    );
    expect(body.columns).toContainEqual(
      expect.objectContaining({
        name: "note",
        category: "field",
        source: "server",
      }),
    );
    expect(body.warnings).toEqual([]);
    const catalog = fake.requests.find((request) => request.db === "_internal");
    expect(catalog?.body).toMatchObject({ params: { db: "smoke", table } });
    expect(fake.unmatched).toEqual([]);
  });

  for (const status of [400, 403]) {
    it(`preserves columns and unknown metadata when optional sources return ${status}`, async () => {
      const overrides = P3_METADATA_SCENARIOS.slice(1).map(
        (scenario): Scenario => ({
          ...scenario,
          response: { status, body: "metadata unavailable" },
        }),
      );
      await connect(overrides);
      const { body } = await callTool(client, "describe_table", {
        db: "smoke",
        table: "retired-20261022T000000",
      });
      expect(body.ok).toBe(true);
      expect(body.columns).toContainEqual(
        expect.objectContaining({
          name: "host",
          category: "unknown",
          source: "unknown",
        }),
      );
      expect(body.columns).toContainEqual(
        expect.objectContaining({
          name: "time",
          category: "time",
          source: "inferred",
        }),
      );
      expect(body.deletion).toEqual({ value: "unknown", source: "unknown" });
      expect(body.schema_mode).toEqual({ value: "unknown", source: "unknown" });
      expect(body.warnings).toContainEqual(
        expect.objectContaining({ code: "possibly_deleted" }),
      );
    });
  }

  it("does not infer roles or deletion from unfamiliar successful metadata", async () => {
    const overrides = P3_METADATA_SCENARIOS.slice(1).map(
      (scenario): Scenario => ({
        ...scenario,
        response: {
          status: 200,
          body: [
            {
              key: "host",
              data_type: "new_type",
              deleted: "false",
              schema_mode: "new_mode",
            },
          ],
        },
      }),
    );
    await connect(overrides);
    const { body } = await callTool(client, "describe_table", {
      db: "smoke",
      table: "active",
    });
    expect(body.columns).toContainEqual(
      expect.objectContaining({ name: "host", category: "unknown" }),
    );
    expect(body.deletion).toEqual({ value: "unknown", source: "unknown" });
    expect(body.schema_mode).toEqual({ value: "unknown", source: "unknown" });
  });

  it("preserves authoritative metadata when sampling fails", async () => {
    await connect([
      {
        ...P3_METADATA_SCENARIOS[0],
        request: {
          method: "POST",
          path: "/api/v3/query_sql",
          q: /^SELECT \* FROM/u,
        },
        response: { status: 403, body: "sample denied" },
      },
    ]);
    const { body } = await callTool(client, "investigate_database", {
      db: "smoke",
      includeSamples: true,
      maxTables: 1,
    });
    expect(body.tables).toContainEqual(
      expect.objectContaining({
        status: "partial",
        schema_mode: {
          value: "implicit",
          source: "server",
          catalog: "system.databases",
        },
        deletion: { value: false, source: "server", catalog: "system.tables" },
      }),
    );
    expect(body.query_budget.used).toBeLessThanOrEqual(body.query_budget.max);
  });
});
