import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServerConfig } from "../src/config.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";

function okFetchResponse(): any {
  return {
    ok: true,
    headers: {
      get: () => undefined,
    },
    json: async () => ({ status: "pass" }),
  };
}

function configFor(type: InfluxProductType, token: string): McpServerConfig {
  return {
    influx: {
      url: "http://localhost:8181",
      token,
      type,
    },
    server: {
      name: "test",
      version: "1.0.0",
    },
    tools: {
      profile: "operator",
    },
  };
}

describe("BaseConnectionService auth headers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Bearer auth for Enterprise JWT credentials on ping and health", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFetchResponse());
    const service = new BaseConnectionService(
      configFor(InfluxProductType.Enterprise, "jwt.header.payload"),
    );

    await service.ping();
    await service.getHealthStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8181/ping",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer jwt.header.payload",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8181/health",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer jwt.header.payload",
        },
      }),
    );
  });

  it("keeps Token auth for Cloud Serverless", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okFetchResponse());
    const service = new BaseConnectionService(
      configFor(InfluxProductType.CloudServerless, "serverless-token"),
    );

    await service.ping();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8181/ping",
      expect.objectContaining({
        headers: {
          Authorization: "Token serverless-token",
        },
      }),
    );
  });
});
