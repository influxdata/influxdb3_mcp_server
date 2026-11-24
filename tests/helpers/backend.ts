import { URL } from "node:url";
import type { Scenario } from "../fixtures/influxdb-scenarios.js";
import { FakeInfluxDB, startFakeInfluxDB } from "./fake-influxdb.js";

export const LIVE =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

export interface Backend {
  env: Record<string, string>;
  fake?: FakeInfluxDB;
  seed: (db: string, lineProtocol: string) => Promise<void>;
  close: () => Promise<void>;
}

export async function startBackend(scenarios: Scenario[]): Promise<Backend> {
  if (LIVE) return liveBackend();

  const fake = await startFakeInfluxDB(scenarios);
  return {
    env: {
      INFLUX_DB_INSTANCE_URL: fake.url,
      INFLUX_DB_TOKEN: "fake-token",
      INFLUX_DB_PRODUCT_TYPE: "core",
      MCP_LOG_TOOL_CALLS: "false",
    },
    fake,
    seed: async () => {},
    close: fake.close,
  };
}

function liveBackend(): Backend {
  const url = requiredEnv("INFLUX_DB_INSTANCE_URL");
  const token = requiredEnv("INFLUX_DB_TOKEN");

  return {
    env: {
      INFLUX_DB_INSTANCE_URL: url,
      INFLUX_DB_TOKEN: token,
      INFLUX_DB_PRODUCT_TYPE: process.env.INFLUX_DB_PRODUCT_TYPE ?? "core",
      MCP_LOG_TOOL_CALLS: "false",
    },
    seed: async (db, lineProtocol) => {
      const target = new URL("api/v3/write_lp", withTrailingSlash(url));
      target.searchParams.set("db", db);
      target.searchParams.set("precision", "second");
      const response = await fetch(target, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: lineProtocol,
      });
      if (!response.ok) {
        throw new Error(
          `Seeding ${db} failed: ${response.status} ${await response.text()}`,
        );
      }
    },
    close: async () => {},
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when INFLUX_TEST_ENABLED is set`);
  }
  return value;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
