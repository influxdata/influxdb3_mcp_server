import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

const PRODUCT_TYPE = process.env.INFLUX_DB_PRODUCT_TYPE ?? "core";
const TEST_DATABASE = process.env.INFLUX_TEST_DATABASE;
const USES_CORE_OR_ENTERPRISE_V3_API =
  PRODUCT_TYPE === "core" || PRODUCT_TYPE === "enterprise";

describe.skipIf(!RUN)("live InfluxDB integration", () => {
  let testClient: TestClient;

  function textContent(result: any): string {
    return (result.content as Array<{ type: string; text: string }>)[0]?.text;
  }

  async function deleteDatabaseLeftByAnyRun(name: string) {
    await testClient.client.callTool({
      name: "delete_database",
      arguments: { name },
    });
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
    expect(JSON.parse(text).connection.status).toBe("healthy");
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
    const dbResult = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    const dbBody = JSON.parse(textContent(dbResult));

    if (!TEST_DATABASE && dbBody.database_count === 0) {
      return;
    }

    const firstDiscoveredDatabase = dbBody.databases[0]?.name;
    const dbName = TEST_DATABASE ?? firstDiscoveredDatabase;
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

  it.skipIf(!USES_CORE_OR_ENTERPRISE_V3_API)(
    "update_database sets a retention period (Core/Enterprise v3 API only; other products have no retention_period update path)",
    async () => {
      const dbName = "mcp_it_retention";
      const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;

      await deleteDatabaseLeftByAnyRun(dbName);

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

      await deleteDatabaseLeftByAnyRun(dbName);
    },
  );

  it.skipIf(!USES_CORE_OR_ENTERPRISE_V3_API)(
    "creates and deletes an expiring named admin token",
    async () => {
      const tokenName = `mcp_it_admin_${PRODUCT_TYPE}_${Date.now()}`;

      try {
        const created = await testClient.client.callTool({
          name: "create_admin_token",
          arguments: { name: tokenName, expiry_secs: 3600 },
        });
        const text = textContent(created);

        expect((created as { isError?: boolean }).isError).not.toBe(true);
        expect(text).toContain("Admin token created successfully");
      } finally {
        const deleted = await testClient.client.callTool({
          name: "delete_token",
          arguments: { token_name: tokenName },
        });
        expect((deleted as { isError?: boolean }).isError).not.toBe(true);
      }
    },
  );
});
