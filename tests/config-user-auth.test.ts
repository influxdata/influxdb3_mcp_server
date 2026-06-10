import { describe, it, expect } from "vitest";
import { validateConfig, McpServerConfig } from "../src/config.js";

function makeConfig(
  influx: Partial<McpServerConfig["influx"]>,
): McpServerConfig {
  return {
    influx: { type: "enterprise", ...influx },
    server: { name: "influxdb-mcp-server", version: "0.0.0" },
  };
}

describe("validateConfig user auth", () => {
  it("accepts enterprise with token only", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", token: "t" })),
    ).not.toThrow();
  });

  it("accepts enterprise with username and password only", () => {
    expect(() =>
      validateConfig(
        makeConfig({ url: "http://x:8181", username: "alice", password: "pw" }),
      ),
    ).not.toThrow();
  });

  it("rejects enterprise with both token and credentials", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          url: "http://x:8181",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/Set exactly one/);
  });

  it("rejects enterprise with username but no password", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", username: "alice" })),
    ).toThrow(/INFLUX_DB_PASSWORD is required/);
  });

  it("rejects enterprise with password but no username", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", password: "pw" })),
    ).toThrow(/INFLUX_DB_USERNAME is required/);
  });

  it("rejects enterprise with neither token nor credentials, naming both options", () => {
    expect(() => validateConfig(makeConfig({ url: "http://x:8181" }))).toThrow(
      /INFLUX_DB_TOKEN.*INFLUX_DB_USERNAME/s,
    );
  });

  it("rejects credentials for core", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          type: "core",
          url: "http://x:8181",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/only supported.*enterprise/i);
  });

  it("rejects credentials for cloud-serverless", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          type: "cloud-serverless",
          url: "http://x",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/only supported.*enterprise/i);
  });
});
