/**
 * `ping()` — version/build header parsing.
 *
 * The `x-influxdb-version` and `x-influxdb-build` response headers are fetched
 * but never parsed, compared, or otherwise used. This pins the current
 * passthrough behavior, independent of any specific InfluxDB version.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import type { McpServerConfig } from "../src/config.js";

const TOKEN = "test-token-not-used";

function configFor(type: InfluxProductType): McpServerConfig {
  return {
    influx: {
      url: "http://localhost:19999/",
      token: TOKEN,
      type,
      cluster_id:
        type === InfluxProductType.CloudDedicated
          ? "00000000-0000-0000-0000-000000000000"
          : undefined,
    },
    server: { name: "influxdb-mcp-server", version: "test" },
    tools: { profile: "operator" },
  };
}

/** Stub `fetch` with a success response and return the recorded calls. */
function stubFetchOk(headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => ({ status: "pass" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ping – version reporting, current behavior", () => {
  it("returns the x-influxdb-version header unparsed", async () => {
    const fetchMock = stubFetchOk({
      "x-influxdb-version": "3.11.0-0.rc.1",
      "x-influxdb-build": "Enterprise",
    });

    const result = await new BaseConnectionService(
      configFor(InfluxProductType.Enterprise),
    ).ping();

    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      version: "3.11.0-0.rc.1",
      build: "Enterprise",
    });
  });

  it('reports build "Other" when only a version header is present', async () => {
    stubFetchOk({ "x-influxdb-version": "3.11.0" });

    const result = await new BaseConnectionService(
      configFor(InfluxProductType.Core),
    ).ping();

    expect(result).toEqual({ ok: true, version: "3.11.0", build: "Other" });
  });

  it("reports no version at all when the header is absent", async () => {
    stubFetchOk();
    const result = await new BaseConnectionService(
      configFor(InfluxProductType.Enterprise),
    ).ping();

    expect(result).toEqual({ ok: true, version: undefined, build: undefined });
  });
});
