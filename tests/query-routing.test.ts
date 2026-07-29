import { describe, expect, it, vi } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { QueryService } from "../src/services/query.service.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";

const QUERY = "SELECT * FROM cpu WHERE host = $host";
const DATABASE = "metrics";
const PARAMS = { host: "edge-01" };
const TIMEOUT_MS = 1_500;

function stubBaseService(type: InfluxProductType): BaseConnectionService {
  return {
    validateDataCapabilities: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn(),
    getClient: vi.fn(),
  } as unknown as BaseConnectionService;
}

function emptyAsyncResult() {
  return (async function* () {})();
}

describe("query routing options", () => {
  it.each([
    ["core", InfluxProductType.Core],
    ["enterprise", InfluxProductType.Enterprise],
  ])(
    "%s forwards params and timeout to the v3 SQL API",
    async (_name, type) => {
      const base = stubBaseService(type);
      const httpClient = { post: vi.fn().mockResolvedValue([]) };
      vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);

      await new QueryService(base).executeQuery(QUERY, DATABASE, {
        params: PARAMS,
        timeoutMs: TIMEOUT_MS,
      });

      expect(httpClient.post).toHaveBeenCalledWith(
        "/api/v3/query_sql",
        { db: DATABASE, q: QUERY, format: "json", params: PARAMS },
        expect.objectContaining({ timeout: TIMEOUT_MS }),
      );
    },
  );

  it.each([
    ["cloud-dedicated", InfluxProductType.CloudDedicated],
    ["cloud-serverless", InfluxProductType.CloudServerless],
  ])("%s forwards params to the Flight client", async (_name, type) => {
    const base = stubBaseService(type);
    const client = { queryPoints: vi.fn().mockReturnValue(emptyAsyncResult()) };
    vi.mocked(base.getClient).mockReturnValue(client as any);

    await new QueryService(base).executeQuery(QUERY, DATABASE, {
      params: PARAMS,
    });

    expect(client.queryPoints).toHaveBeenCalledWith(QUERY, DATABASE, {
      type: "sql",
      params: PARAMS,
    });
  });

  it.each([
    ["cloud-dedicated", InfluxProductType.CloudDedicated],
    ["cloud-serverless", InfluxProductType.CloudServerless],
  ])("%s rejects per-query timeout explicitly", async (_name, type) => {
    const base = stubBaseService(type);
    vi.mocked(base.getClient).mockReturnValue({
      queryPoints: vi.fn().mockReturnValue(emptyAsyncResult()),
    } as any);

    await expect(
      new QueryService(base).executeQuery(QUERY, DATABASE, {
        timeoutMs: TIMEOUT_MS,
      }),
    ).rejects.toThrow(/timeoutMs is not supported.*Flight/i);
  });

  it("clustered forwards params and timeout to its query API", async () => {
    const base = stubBaseService(InfluxProductType.Clustered);
    const httpClient = { get: vi.fn().mockResolvedValue({}) };
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);
    const service = new QueryService(base);

    await service.executeQuery(QUERY, DATABASE, {
      params: PARAMS,
      timeoutMs: TIMEOUT_MS,
    });

    expect(httpClient.get).toHaveBeenCalledWith("/query", {
      params: { db: DATABASE, q: QUERY, params: PARAMS },
      timeout: TIMEOUT_MS,
    });
  });

  it("preserves InfluxQL params and timeout on the v3 API", async () => {
    const base = stubBaseService(InfluxProductType.Core);
    const httpClient = { post: vi.fn().mockResolvedValue([]) };
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);

    await new QueryService(base).executeInfluxqlQuery(QUERY, DATABASE, {
      params: PARAMS,
      timeoutMs: TIMEOUT_MS,
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v3/query_influxql",
      { db: DATABASE, q: QUERY, format: "json", params: PARAMS },
      expect.objectContaining({ timeout: TIMEOUT_MS }),
    );
  });

  it("preserves the Clustered InfluxQL timeout", async () => {
    const base = stubBaseService(InfluxProductType.Clustered);
    const httpClient = { get: vi.fn().mockResolvedValue({}) };
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);

    await new QueryService(base).executeInfluxqlQuery(
      "SELECT * FROM cpu",
      DATABASE,
      { timeoutMs: TIMEOUT_MS },
    );

    expect(httpClient.get).toHaveBeenCalledWith(
      "/query",
      expect.objectContaining({ timeout: TIMEOUT_MS }),
    );
  });
});
