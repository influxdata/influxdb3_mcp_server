import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

// Update this when tools are added or removed.
// Verified against: src/tools/index.ts createTools() aggregation.
// help(2) + write(1) + database(4) + query(3) + token(6) + cloud-token(5) + health(1) = 22
const EXPECTED_TOOL_COUNT = 22;

const EXPECTED_RESOURCE_URIS = [
  "influx://config",
  "influx://status",
  "influx://databases",
  "influx://context",
];

const EXPECTED_PROMPT_NAMES = [
  "list-databases",
  "check-health",
  "load-context",
];

describe("MCP protocol compliance", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient();
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("completes initialize handshake and reports capabilities", () => {
    const capabilities = testClient.client.getServerCapabilities();
    expect(capabilities).toBeDefined();
    expect(capabilities).toHaveProperty("tools");
    expect(capabilities).toHaveProperty("resources");
    expect(capabilities).toHaveProperty("prompts");
  });

  it("returns server version info", () => {
    const serverInfo = testClient.client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo?.name).toBe("influxdb-mcp-server");
    expect(serverInfo?.version).toBeDefined();
  });

  describe("tools/list", () => {
    it("returns the expected number of tools", async () => {
      const result = await testClient.client.listTools();
      expect(result.tools).toHaveLength(EXPECTED_TOOL_COUNT);
    });

    it("each tool has name, description, and inputSchema", async () => {
      const result = await testClient.client.listTools();
      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("includes core tools by name", async () => {
      const result = await testClient.client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("health_check");
      expect(names).toContain("execute_query");
      expect(names).toContain("write_line_protocol");
      expect(names).toContain("list_databases");
      expect(names).toContain("create_admin_token");
    });
  });

  describe("resources/list", () => {
    it("returns all expected resources", async () => {
      const result = await testClient.client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toEqual(expect.arrayContaining(EXPECTED_RESOURCE_URIS));
      expect(result.resources).toHaveLength(EXPECTED_RESOURCE_URIS.length);
    });

    it("each resource has name, uri, and description", async () => {
      const result = await testClient.client.listResources();
      for (const resource of result.resources) {
        expect(resource.name).toBeTruthy();
        expect(resource.uri).toBeTruthy();
        expect(resource.description).toBeTruthy();
      }
    });
  });

  describe("prompts/list", () => {
    it("returns all expected prompts", async () => {
      const result = await testClient.client.listPrompts();
      const names = result.prompts.map((p) => p.name);
      expect(names).toEqual(expect.arrayContaining(EXPECTED_PROMPT_NAMES));
      expect(result.prompts).toHaveLength(EXPECTED_PROMPT_NAMES.length);
    });
  });

  describe("ping", () => {
    it("responds to ping", async () => {
      const result = await testClient.client.ping();
      expect(result).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("throws McpError for unknown tool", async () => {
      await expect(
        testClient.client.callTool({
          name: "nonexistent_tool",
          arguments: {},
        }),
      ).rejects.toThrow("Unknown tool: nonexistent_tool");
    });
  });
});
