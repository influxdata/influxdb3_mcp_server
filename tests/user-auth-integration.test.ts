import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";

const RUN =
  (process.env.INFLUX_TEST_ENABLED === "true" ||
    process.env.INFLUX_TEST_ENABLED === "1") &&
  !!process.env.INFLUX_DB_USERNAME &&
  !!process.env.INFLUX_DB_PASSWORD &&
  !!process.env.INFLUX_DB_INSTANCE_URL;

const DB = process.env.INFLUX_DB_TEST_DATABASE || "user_auth_test";

function toolText(result: any): string {
  return (
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ""
  );
}

describe.skipIf(!RUN)("live Enterprise user-auth integration", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient({
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL!,
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_DB_TOKEN: "",
      INFLUX_DB_USERNAME: process.env.INFLUX_DB_USERNAME!,
      INFLUX_DB_PASSWORD: process.env.INFLUX_DB_PASSWORD!,
    });
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("health_check succeeds with user credentials", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });
    expect(toolText(result)).toMatch(/healthy|pass|ok/i);
  });

  it("lists databases as the authenticated user", async () => {
    const result = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
  });

  it("writes and queries back a point (SDK write path + HTTP query path)", async () => {
    await testClient.client.callTool({
      name: "create_database",
      arguments: { name: DB },
    });
    const write = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: DB,
        data: `user_auth_smoke,source=mcp value=1i`,
        precision: "second",
      },
    });
    expect(write.isError).toBeFalsy();
    const query = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: DB,
        query: "SELECT * FROM user_auth_smoke ORDER BY time DESC LIMIT 1",
      },
    });
    expect(toolText(query)).toContain("user_auth_smoke");
  });

  it("config resource reports user auth mode", async () => {
    const result = await testClient.client.readResource({
      uri: "influx://config",
    });
    const config = JSON.parse((result.contents[0] as { text: string }).text);
    expect(config.connection.authMode).toBe("user");
  });

  // Verifies PR #69 compatibility: /ping and /health receive the Enterprise
  // user-auth JWT as a Bearer credential. The health_check tool cannot verify
  // this by itself because it reports healthy if any check passes.
  it("ping and health each accept the user-auth JWT under the Bearer scheme", async () => {
    const svc = new BaseConnectionService({
      influx: {
        type: "enterprise",
        url: process.env.INFLUX_DB_INSTANCE_URL!,
        username: process.env.INFLUX_DB_USERNAME!,
        password: process.env.INFLUX_DB_PASSWORD!,
      },
      server: { name: "influxdb-mcp-server", version: "0.0.0" },
    });
    const ping = await svc.ping();
    expect(ping).toMatchObject({ ok: true });
    const health = await svc.getHealthStatus();
    expect(health.status).not.toBe("fail");
  });
});
