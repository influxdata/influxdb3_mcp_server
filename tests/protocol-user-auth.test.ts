import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

// Keep in sync with EXPECTED_TOOL_COUNT in tests/protocol.test.ts.
const EXPECTED_TOOL_COUNT = 22;

describe("MCP protocol in enterprise user-auth mode", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient({
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_DB_TOKEN: "",
      INFLUX_DB_USERNAME: "alice",
      INFLUX_DB_PASSWORD: "test-password-not-used",
    });
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("starts and advertises the same tool count as token mode", async () => {
    const result = await testClient.client.listTools();
    expect(result.tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("reports user auth mode in the config resource without secrets", async () => {
    const result = await testClient.client.readResource({
      uri: "influx://config",
    });
    const text = (result.contents[0] as { text: string }).text;
    const config = JSON.parse(text);
    expect(config.connection.authMode).toBe("user");
    expect(config.connection.username).toBe("alice");
    expect(text).not.toContain("test-password-not-used");
  });
});
