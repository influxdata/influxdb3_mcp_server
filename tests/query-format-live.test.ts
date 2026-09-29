import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";
const TEST_DATABASE = process.env.INFLUX_TEST_DATABASE;

describe.skipIf(!RUN)("live query format behavior", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    if (!TEST_DATABASE) {
      throw new Error("INFLUX_TEST_DATABASE is required for live format tests");
    }

    testClient = await createTestClient({
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL ?? "",
      INFLUX_DB_TOKEN: process.env.INFLUX_DB_TOKEN ?? "",
      INFLUX_DB_PRODUCT_TYPE:
        process.env.INFLUX_DB_PRODUCT_TYPE ?? "cloud-serverless",
    });
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("doesn't stringify Cloud Serverless CSV rows as objects (#107)", async () => {
    const result = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: TEST_DATABASE,
        query: "SELECT 1 AS a UNION ALL SELECT 2 AS a",
        format: "csv",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      ?.text;

    const explicitError = (result as { isError?: boolean }).isError === true;
    if (!explicitError && text.includes("[object Object]")) {
      throw new Error(
        "Reproduced #107: the authenticated Cloud Serverless query returned [object Object] for CSV output",
      );
    }

    expect(explicitError || !text.includes("[object Object]")).toBe(true);
  });
});
