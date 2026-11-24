import { afterEach, describe, expect, it } from "vitest";
import type {
  Scenario,
  ScenarioProvenance,
} from "./fixtures/influxdb-scenarios.js";
import { startFakeInfluxDB, FakeInfluxDB } from "./helpers/fake-influxdb.js";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";
import { expectValidEnvelope } from "./helpers/envelope.js";

const INFLUXDB3_CLOUD_CLUSTER_UUID = "00000000-0000-4000-8000-000000000c10";

const influxdb3CloudClaim = (claimIds: string): ScenarioProvenance => ({
  products: ["enterprise"],
  version: "3.12.2",
  source: "claim",
  detail: `InfluxDB 3 Cloud, ${claimIds}`,
});

const INFLUXDB3_CLOUD_HEALTH_ABSENT: Scenario = {
  name: "InfluxDB 3 Cloud has no /health",
  provenance: {
    ...influxdb3CloudClaim("claim-20261120-0006"),
    outside_spec: "The public health spec omits 404.",
  },
  request: { method: "GET", path: "/health" },
  response: { status: 404, body: "" },
};

const INFLUXDB3_CLOUD_ADMIN_PING: Scenario = {
  name: "InfluxDB 3 Cloud /ping with an admin token",
  provenance: influxdb3CloudClaim("claim-20261120-0004, claim-20261120-0007"),
  request: { method: "GET", path: "/ping" },
  response: {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cluster-uuid": INFLUXDB3_CLOUD_CLUSTER_UUID,
      "x-influxdb-build": "Enterprise",
      "x-influxdb-version": "3.12.2",
    },
    body: {
      product_name: "InfluxDB 3 Enterprise",
      version: "3.12.2",
      revision: "f1972a0",
    },
  },
};

const INFLUXDB3_CLOUD_SCOPED_PING: Scenario = {
  name: "InfluxDB 3 Cloud /ping with a database-scoped token",
  provenance: influxdb3CloudClaim("claim-20261120-0005"),
  request: { method: "GET", path: "/ping" },
  response: {
    status: 403,
    headers: { "cluster-uuid": INFLUXDB3_CLOUD_CLUSTER_UUID },
    body: "",
  },
};

let fake: FakeInfluxDB | undefined;
let session: TestClient | undefined;

afterEach(async () => {
  await session?.close();
  await fake?.close();
  session = undefined;
  fake = undefined;
});

async function healthCheckAgainst(scenarios: Scenario[]) {
  fake = await startFakeInfluxDB(scenarios);
  session = await createTestClient({
    INFLUX_DB_INSTANCE_URL: fake.url,
    INFLUX_DB_PRODUCT_TYPE: "enterprise",
  });
  const result = (await session.client.callTool({
    name: "health_check",
    arguments: {},
  })) as { content: Array<{ text: string }> };
  const healthPayload = JSON.parse(result.content[0].text);
  expectValidEnvelope(healthPayload, "health_check");
  return healthPayload;
}

describe("health_check against InfluxDB 3 Cloud", () => {
  it("reports /health as absent, not unreachable, and stays healthy on /ping", async () => {
    const result = await healthCheckAgainst([
      INFLUXDB3_CLOUD_HEALTH_ABSENT,
      INFLUXDB3_CLOUD_ADMIN_PING,
    ]);
    expect(result.health.outcome).toBe("endpoint_absent");
    expect(result.ping).toMatchObject({
      ok: true,
      outcome: "ok",
      version: "3.12.2",
      build: "Enterprise",
      cluster_uuid: INFLUXDB3_CLOUD_CLUSTER_UUID,
    });
    expect(result.connection).toMatchObject({
      status: "healthy",
      reachable: true,
    });
  });

  it("keeps the cluster UUID from a denied /ping", async () => {
    const result = await healthCheckAgainst([
      INFLUXDB3_CLOUD_HEALTH_ABSENT,
      INFLUXDB3_CLOUD_SCOPED_PING,
    ]);
    expect(result.health.outcome).toBe("endpoint_absent");
    expect(result.ping).toMatchObject({
      ok: false,
      outcome: "credential_cannot_check",
      cluster_uuid: INFLUXDB3_CLOUD_CLUSTER_UUID,
    });
    expect(result.ping).not.toHaveProperty("version");
    expect(result.connection).toMatchObject({
      status: "unknown",
      reachable: true,
    });
  });
});
