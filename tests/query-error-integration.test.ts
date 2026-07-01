import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

describe.skipIf(!RUN)("error path integration tests (live Core)", () => {
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

  it("execute_query on nonexistent database surfaces real error", async () => {
    const result = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: "nonexistent_db_xyz",
        query: "SELECT 1",
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]
      ?.text;

    expect(text).toMatch(/database not found/i);
    expect(text).not.toMatch("Internal Server Error");
  });

  it("execute_query with invalid SQL surfaces parser error", async () => {
    const dbResult = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    const dbBody = JSON.parse(textContent(dbResult));

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
        query: "THIS IS NOT SQL",
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]
      ?.text;

    expect(text).toMatch(/ParserError|SQL error/i);
  });
});
