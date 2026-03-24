import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

describe.skipIf(!RUN)("live InfluxDB integration", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient({
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL ?? "",
      INFLUX_DB_TOKEN: process.env.INFLUX_DB_TOKEN ?? "",
      INFLUX_DB_PRODUCT_TYPE: process.env.INFLUX_DB_PRODUCT_TYPE ?? "core",
    });
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
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      ?.text;
    expect(text).toBeDefined();
    expect(text).toContain("Found");
  });

  it("execute_query runs a simple query", async () => {
    // First get a database name from list_databases
    const dbResult = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    const dbText = (
      dbResult.content as Array<{ type: string; text: string }>
    )[0]?.text;

    // If no databases exist, skip gracefully
    if (dbText?.includes("Found 0 databases")) {
      return;
    }

    // Extract first database name from the JSON in the response
    const dbMatch = dbText?.match(/"name":\s*"([^"]+)"/);
    if (!dbMatch) {
      return;
    }

    const result = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: dbMatch[1],
        query: "SELECT 1 AS test",
      },
    });
    expect(result.content).toBeDefined();
    expect((result as { isError?: boolean }).isError).not.toBe(true);
  });
});
