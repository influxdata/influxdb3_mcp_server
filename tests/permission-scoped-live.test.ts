import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "./helpers/mcp-client.js";
import { assertEnvelope } from "./helpers/contracts.js";

const run =
  ["true", "1"].includes(process.env.INFLUX_TEST_ENABLED || "") &&
  process.env.INFLUX_TEST_SCOPED === "true";
describe.skipIf(!run)("[live-only] scoped Enterprise database access", () => {
  let session: TestClient;
  beforeAll(async () => {
    const env: Record<string, string> = { INFLUX_MCP_TOOL_PROFILE: "readonly" };
    for (const key of [
      "INFLUX_DB_INSTANCE_URL",
      "INFLUX_DB_PRODUCT_TYPE",
      "INFLUX_DB_TOKEN",
    ]) {
      const value = process.env[key];
      if (!value) throw new Error(`Scoped check requires ${key}`);
      env[key] = value;
    }
    session = await createTestClient(env);
  });
  afterAll(async () => {
    await session?.close();
  });
  async function call(name: string, args: Record<string, unknown>) {
    const result = await session.client.callTool({ name, arguments: args });
    const content = result.content;
    if (!Array.isArray(content) || content[0].type !== "text")
      throw new Error("Expected text");
    const body = JSON.parse(content[0].text);
    assertEnvelope(body);
    return body;
  }
  it("keeps permitted reads usable after denial on another database", async () => {
    const readable = process.env.INFLUX_TEST_DATABASE || "smoke";
    const denied = process.env.INFLUX_TEST_DENIED_DATABASE || "host_system";
    expect((await call("list_tables", { db: readable })).ok).toBe(true);
    for (const name of [
      "query_sql",
      "query_influxql",
      "list_tables",
      "investigate_database",
    ]) {
      const result = await call(name, {
        db: denied,
        ...(name.startsWith("query_")
          ? { q: "SELECT * FROM metrics LIMIT 1" }
          : {}),
      });
      expect(result.ok).toBe(false);
      expect(["access_denied", "not_found_or_denied"]).toContain(
        result.error.code,
      );
    }
    const health = await call("health_check", {});
    if (
      health.health.outcome === "credential_cannot_check" &&
      health.ping.outcome === "credential_cannot_check"
    ) {
      expect(health.connection).toMatchObject({
        status: "unknown",
        reachable: true,
      });
    }
    expect((await call("list_tables", { db: readable })).ok).toBe(true);
  });
});
