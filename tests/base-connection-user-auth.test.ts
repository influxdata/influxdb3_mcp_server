import { afterEach, describe, it, expect, vi } from "vitest";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { McpServerConfig } from "../src/config.js";

function makeConfig(
  influx: Partial<McpServerConfig["influx"]>,
): McpServerConfig {
  return {
    influx: { type: "enterprise", ...influx },
    server: { name: "influxdb-mcp-server", version: "0.0.0" },
  };
}

const USER_AUTH_CONFIG = makeConfig({
  url: "http://localhost:8181",
  username: "alice",
  password: "pw",
});

function okFetchResponse(): any {
  return {
    ok: true,
    headers: {
      get: () => undefined,
    },
    json: async () => ({ status: "pass" }),
  };
}

describe("BaseConnectionService in user-auth mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports data and management capabilities with credentials only", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    expect(svc.hasDataCapabilities()).toBe(true);
    expect(svc.hasManagementCapabilities()).toBe(true);
    expect(() => svc.validateDataCapabilities()).not.toThrow();
    expect(() => svc.validateManagementCapabilities()).not.toThrow();
  });

  it("still requires auth: enterprise with neither token nor credentials has no capabilities", () => {
    const svc = new BaseConnectionService(
      makeConfig({ url: "http://localhost:8181" }),
    );
    expect(svc.hasDataCapabilities()).toBe(false);
    expect(() => svc.validateDataCapabilities()).toThrow(
      /INFLUX_DB_TOKEN|credentials/i,
    );
  });

  it("token mode is unchanged", () => {
    const svc = new BaseConnectionService(
      makeConfig({ type: "core", url: "http://localhost:8181", token: "t" }),
    );
    expect(svc.hasDataCapabilities()).toBe(true);
    expect(svc.getConnectionInfo().authMode).toBe("token");
  });

  it("reports user auth mode and username in connection info", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    const info = svc.getConnectionInfo();
    expect(info.authMode).toBe("user");
    expect(info.username).toBe("alice");
    expect(info.hasToken).toBe(true); // "auth is configured"
  });

  it("builds the SDK client lazily after login and rebuilds on token rotation", async () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    let version = 1;
    // Replace the internal auth service with a stub: no network in unit tests.
    (svc as any).userAuth = {
      getToken: async () => `tok-${version}`,
      forceRefresh: async () => `tok-${++version}`,
      getTokenVersion: () => version,
      getAuthInfo: () => ({ username: "alice" }),
    };
    const first = await svc.getClient();
    expect(first).not.toBeNull();
    const again = await svc.getClient();
    expect(again).toBe(first); // same version, same client
    version = 2;
    const rebuilt = await svc.getClient();
    expect(rebuilt).not.toBe(first); // rotated token, rebuilt client
  });

  it("does not construct the SDK client at startup in user-auth mode", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    expect(svc.getConnectionInfo().isDataClientInitialized).toBe(false);
  });

  it("uses Bearer auth for Enterprise static-token ping and health", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFetchResponse());
    const svc = new BaseConnectionService(
      makeConfig({ url: "http://localhost:8181", token: "static-token" }),
    );

    await svc.ping();
    await svc.getHealthStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8181/ping",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer static-token",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8181/health",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer static-token",
        },
      }),
    );
  });

  it("uses Bearer auth for Enterprise user-auth ping and health", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFetchResponse());
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    (svc as any).userAuth = {
      getToken: async () => "jwt-token",
      forceRefresh: async () => "jwt-token",
      getTokenVersion: () => 1,
      getAuthInfo: () => ({ username: "alice" }),
    };

    await svc.ping();
    await svc.getHealthStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8181/ping",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer jwt-token",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8181/health",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer jwt-token",
        },
      }),
    );
  });

  it("keeps Token auth for Cloud Serverless ping and health", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFetchResponse());
    const svc = new BaseConnectionService(
      makeConfig({
        type: "cloud-serverless",
        url: "http://localhost:8181",
        token: "serverless-token",
      }),
    );

    await svc.ping();
    await svc.getHealthStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8181/ping",
      expect.objectContaining({
        headers: {
          Authorization: "Token serverless-token",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8181/health",
      expect.objectContaining({
        headers: {
          Authorization: "Token serverless-token",
        },
      }),
    );
  });
});
