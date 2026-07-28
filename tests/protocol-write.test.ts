/**
 * Protocol-boundary tests for `write_line_protocol` and `health_check`.
 *
 * These run against the compiled server over stdio with an unreachable
 * InfluxDB host — no instance is contacted for anything in this file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

/**
 * Minimum viable environment per product type, per `validateConfig`
 * (`src/config.ts`). The host is unreachable by design.
 */
const PRODUCT_ENVS: Record<string, Record<string, string>> = {
  core: {
    INFLUX_DB_PRODUCT_TYPE: "core",
    INFLUX_DB_INSTANCE_URL: "http://localhost:19999/",
    INFLUX_DB_TOKEN: "test-token-not-used",
  },
  enterprise: {
    INFLUX_DB_PRODUCT_TYPE: "enterprise",
    INFLUX_DB_INSTANCE_URL: "http://localhost:19999/",
    INFLUX_DB_TOKEN: "test-token-not-used",
  },
};

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("write_line_protocol – advertised contract", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(PRODUCT_ENVS.core);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  async function writeTool() {
    const { tools } = await testClient.client.listTools();
    const tool = tools.find((t) => t.name === "write_line_protocol");
    expect(tool, "write_line_protocol must be advertised").toBeDefined();
    return tool!;
  }

  it("requires database, data and precision", async () => {
    const schema = (await writeTool()).inputSchema as any;

    expect(schema.required.sort()).toEqual(["data", "database", "precision"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("advertises the four precision values the service maps", async () => {
    // `mapPrecisionForCloud` in write.service.ts has an entry per value; an
    // unmapped value would produce `undefined` in the Cloud/Clustered query
    // string. Keeping the advertised enum and the map in step is what stops
    // that.
    const schema = (await writeTool()).inputSchema as any;

    expect(schema.properties.precision.enum).toEqual([
      "nanosecond",
      "microsecond",
      "millisecond",
      "second",
    ]);
  });

  it("advertises acceptPartial defaulting to true", async () => {
    // The advertised default must match the service default, because the
    // partial-write response shape depends on it.
    const schema = (await writeTool()).inputSchema as any;

    expect(schema.properties.acceptPartial.default).toBe(true);
    expect(schema.properties.noSync.default).toBe(false);
  });

  it("rejects an unknown precision at the validation boundary", async () => {
    // zodSchema and inputSchema are maintained separately and must agree.
    await expect(
      testClient.client.callTool({
        name: "write_line_protocol",
        arguments: { database: "mydb", data: "m f=1i", precision: "hour" },
      }),
    ).rejects.toThrow();
  });
});

describe("write failures reach the model as tool errors", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(PRODUCT_ENVS.core);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("returns isError with non-empty text rather than throwing", async () => {
    // The host is unreachable, so this exercises the transport-failure path:
    // no `error.response`, so `handleWriteError` falls through to the fallback
    // and interpolates `error.message`.
    const result = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: "mydb",
        data: "m,t=a f=1i",
        precision: "nanosecond",
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).not.toBe("");
  });

  it("never renders an error body as [object Object]", async () => {
    // The protocol-boundary half of this check. The unit-level half — where a
    // parsed JSON body is what gets interpolated — is in write-error-core.test.ts.
    const result = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: "mydb",
        data: "m,t=a f=1i",
        precision: "nanosecond",
      },
    });

    expect(textOf(result)).not.toContain("[object Object]");
  });

  it("names the database in the failure message", async () => {
    const result = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: "some_db",
        data: "m,t=a f=1i",
        precision: "nanosecond",
      },
    });

    expect(textOf(result)).toContain("some_db");
  });
});

describe("capability detection – current state", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(PRODUCT_ENVS.core);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("health_check reports HEALTHY against an unreachable instance", async () => {
    // `hasAnySuccess` is set by `connectionInfo.isDataClientInitialized`,
    // which is true whenever a client object was constructed — no request
    // required. Both /ping and /health fail here, and the tool still reports
    // success.
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });

    expect(textOf(result)).toContain("✅ HEALTHY");
  });

  it("reports the configured product type verbatim, unverified", async () => {
    // `INFLUX_DB_PRODUCT_TYPE` is trusted as given (`src/config.ts`); nothing
    // checks it against the instance. Declaring `enterprise` against an
    // unreachable host still reports `enterprise`.
    const client = await createTestClient(PRODUCT_ENVS.enterprise);
    try {
      const result = await client.client.callTool({
        name: "health_check",
        arguments: {},
      });
      expect(textOf(result)).toContain('"type": "enterprise"');
    } finally {
      await client.close();
    }
  });

  it("reports no version when /ping is unreachable", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });
    const text = textOf(result);

    // `ping.version` is populated from the `x-influxdb-version` response
    // header and passed straight through — never parsed, never compared
    // against a minimum.
    expect(text).toContain('"ok": false');
    expect(text).not.toContain('"version"');
  });
});

describe.skip("health_check reflects reachability", () => {
  // Un-skip when the health-reporting bug is fixed. A constructed client is
  // not evidence the instance is reachable; only a successful /ping or
  // /health is.
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(PRODUCT_ENVS.core);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("reports FAILED when every endpoint check fails", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });

    expect(textOf(result)).toContain("❌ FAILED");
  });
});
