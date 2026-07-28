import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

// Retention configuration via update_database is only supported on Core and
// Enterprise, which use the v3 API. Skip the retention test for other product
// types (for example the Cloud Serverless CI job, which manages buckets through
// the v2 API and has no retention_period update path).
const PRODUCT_TYPE = process.env.INFLUX_DB_PRODUCT_TYPE ?? "core";
const RETENTION_SUPPORTED =
  PRODUCT_TYPE === "core" || PRODUCT_TYPE === "enterprise";

describe.skipIf(!RUN)("live InfluxDB integration", () => {
  let testClient: TestClient;

  function textContent(result: any): string {
    return (result.content as Array<{ type: string; text: string }>)[0]?.text;
  }

  beforeAll(async () => {
    const env: Record<string, string> = {};
    if (process.env.INFLUX_DB_INSTANCE_URL)
      env.INFLUX_DB_INSTANCE_URL = process.env.INFLUX_DB_INSTANCE_URL;
    if (process.env.INFLUX_DB_TOKEN)
      env.INFLUX_DB_TOKEN = process.env.INFLUX_DB_TOKEN;
    if (process.env.INFLUX_DB_PRODUCT_TYPE)
      env.INFLUX_DB_PRODUCT_TYPE = process.env.INFLUX_DB_PRODUCT_TYPE;
    testClient = await createTestClient(env);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("health_check reports healthy", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      ?.text;
    expect(text).toContain("HEALTHY");
  });

  it("list_databases returns a response", async () => {
    const result = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    const body = JSON.parse(textContent(result));
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.databases)).toBe(true);
    expect(typeof body.database_count).toBe("number");
  });

  it("execute_query runs a simple query", async () => {
    // First get a database name from list_databases
    const dbResult = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    const dbBody = JSON.parse(textContent(dbResult));

    // If no databases exist, skip gracefully
    if (dbBody.database_count === 0) {
      return;
    }

    const dbName = dbBody.databases[0]?.name;
    if (!dbName) {
      return;
    }

    const result = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: dbName,
        query: "SELECT 1 AS test",
      },
    });
    expect(result.content).toBeDefined();
    expect((result as { isError?: boolean }).isError).not.toBe(true);
  });

  it.skipIf(!RETENTION_SUPPORTED)(
    "update_database sets a retention period (Core/Enterprise)",
    async () => {
      const dbName = "mcp_it_retention";
      const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;

      // Clean slate in case a previous run left the database behind.
      await testClient.client.callTool({
        name: "delete_database",
        arguments: { name: dbName },
      });

      const created = await testClient.client.callTool({
        name: "create_database",
        arguments: { name: dbName },
      });
      expect((created as { isError?: boolean }).isError).not.toBe(true);

      const updated = await testClient.client.callTool({
        name: "update_database",
        arguments: { name: dbName, retentionPeriod: SEVEN_DAYS_NS },
      });
      const text = (updated.content as Array<{ type: string; text: string }>)[0]
        ?.text;
      expect((updated as { isError?: boolean }).isError).not.toBe(true);
      expect(text).toContain("updated successfully");

      // Cleanup.
      await testClient.client.callTool({
        name: "delete_database",
        arguments: { name: dbName },
      });
    },
  );
});
