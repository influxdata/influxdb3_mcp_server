import { afterEach, describe, expect, it } from "vitest";
import { LIVE } from "./helpers/backend.js";
import { FakeInfluxDB, startFakeInfluxDB } from "./helpers/fake-influxdb.js";
import {
  callTool,
  createTestClient,
  TestClient,
} from "./helpers/mcp-client.js";

// Cloud product types point at the fake only to prove nothing is sent: each
// case is refused before dispatch. Cloud Dedicated's data host is derived from
// its cluster ID, so its cases stay in query-routing.test.ts.
describe.skipIf(LIVE)(
  "[fake-only: the testbench has no Cloud target] Cloud query routes refuse unsupported combinations",
  () => {
    let fake: FakeInfluxDB | undefined;
    let mcp: TestClient | undefined;

    async function connect(productType: string): Promise<TestClient> {
      fake = await startFakeInfluxDB([]);
      mcp = await createTestClient({
        INFLUX_DB_INSTANCE_URL: fake.url,
        INFLUX_DB_TOKEN: "fake-token",
        INFLUX_DB_PRODUCT_TYPE: productType,
        MCP_LOG_TOOL_CALLS: "false",
      });
      return mcp;
    }

    afterEach(async () => {
      await mcp?.close();
      await fake?.close();
    });

    it.each(["cloud-serverless", "clustered"])(
      "%s refuses CSV from query_influxql instead of returning JSON labeled CSV (#84)",
      async (productType) => {
        const client = await connect(productType);
        const { body } = await callTool(client, "query_influxql", {
          db: "metrics",
          q: "SELECT usage FROM cpu",
          format: "csv",
        });

        expect(body.error.code).toBe("unsupported_query_format");
        expect(body.error.supported_formats).toEqual(["json"]);
        expect(fake?.requests).toEqual([]);
      },
    );

    it("cloud-serverless refuses timeoutMs on query_sql with a stable code", async () => {
      const client = await connect("cloud-serverless");
      const { body } = await callTool(client, "query_sql", {
        db: "metrics",
        q: "SELECT usage FROM cpu",
        timeoutMs: 500,
      });

      expect(body.error.code).toBe("unsupported_query_option");
      expect(body.error.message).toMatch(/timeoutMs/u);
      expect(fake?.requests).toEqual([]);
    });
  },
);
