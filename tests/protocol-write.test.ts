import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const UNREACHABLE_INFLUX_URL = "http://localhost:19999/";

const MINIMAL_UNREACHABLE_ENV_BY_PRODUCT: Record<
  string,
  Record<string, string>
> = {
  core: {
    INFLUX_DB_PRODUCT_TYPE: "core",
    INFLUX_DB_INSTANCE_URL: UNREACHABLE_INFLUX_URL,
    INFLUX_DB_TOKEN: "test-token-not-used",
  },
  enterprise: {
    INFLUX_DB_PRODUCT_TYPE: "enterprise",
    INFLUX_DB_INSTANCE_URL: UNREACHABLE_INFLUX_URL,
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
    testClient = await createTestClient(
      MINIMAL_UNREACHABLE_ENV_BY_PRODUCT.core,
    );
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

  it("advertises exactly the four precision values that the clustered and cloud-serverless write paths map to short names", async () => {
    const schema = (await writeTool()).inputSchema as any;

    expect(schema.properties.precision.enum).toEqual([
      "nanosecond",
      "microsecond",
      "millisecond",
      "second",
    ]);
  });

  it("advertises acceptPartial defaulting to true, matching the service default the partial-write response shape depends on", async () => {
    const schema = (await writeTool()).inputSchema as any;

    expect(schema.properties.acceptPartial.default).toBe(true);
    expect(schema.properties.noSync.default).toBe(false);
  });

  it("rejects an unknown precision at the validation boundary, as the advertised inputSchema enum does", async () => {
    const result = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: { database: "mydb", data: "m f=1i", precision: "hour" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error.code).toBe("invalid_arguments");
  });
});

describe("write failures reach the model as tool errors", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(
      MINIMAL_UNREACHABLE_ENV_BY_PRODUCT.core,
    );
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("returns isError with the transport error's non-empty text rather than throwing when the host is unreachable", async () => {
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

  it("never renders an error body as [object Object] at the protocol boundary", async () => {
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
    testClient = await createTestClient(
      MINIMAL_UNREACHABLE_ENV_BY_PRODUCT.core,
    );
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("client initialization does not prove an unreachable instance healthy", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });

    expect(JSON.parse(textOf(result)).connection).toMatchObject({
      status: "unhealthy",
      reachable: false,
    });
  });

  it("reports the configured product type verbatim, unverified against the unreachable instance", async () => {
    const client = await createTestClient(
      MINIMAL_UNREACHABLE_ENV_BY_PRODUCT.enterprise,
    );
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

    expect(text).toContain('"ok": false');
    expect(text).not.toContain('"version"');
  });
});

describe.skip("health_check reflects reachability from a successful /ping or /health, not from a constructed client", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient(
      MINIMAL_UNREACHABLE_ENV_BY_PRODUCT.core,
    );
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
