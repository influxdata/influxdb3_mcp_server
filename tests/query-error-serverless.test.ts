import { describe, it, expect, vi } from "vitest";
import { QueryService } from "../src/services/query.service.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import {
  AxiosErrorShape,
  SdkErrorShape,
  SERVERLESS_SDK_400_INVALID_QUERY,
  SERVERLESS_SDK_404_NONEXISTENT_BUCKET,
  SERVERLESS_AXIOS_400_INVALID_QUERY,
  SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET,
  SERVERLESS_V1_QUERY_200_BUCKET_WITHOUT_DBRP,
} from "./fixtures/error-responses.js";

function stubBaseService(type: InfluxProductType): BaseConnectionService {
  return {
    validateDataCapabilities: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn(),
    getClient: vi.fn().mockReturnValue(null),
  } as unknown as BaseConnectionService;
}

function httpClientThrowing(error: AxiosErrorShape) {
  return { postText: vi.fn().mockRejectedValue(error) };
}

function sdkClientThrowing(error: SdkErrorShape) {
  const throwingIterable = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(error);
        },
        return() {
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    },
  };
  return {
    queryPoints: vi.fn().mockReturnValue(throwingIterable),
    write: vi.fn(),
    close: vi.fn(),
  };
}

describe("handleQueryError – Cloud Serverless (SDK async iterator)", () => {
  it("400: surfaces error message from SDK HttpError", async () => {
    const base = stubBaseService(InfluxProductType.CloudServerless);
    vi.mocked(base.getClient).mockReturnValue(
      sdkClientThrowing(SERVERLESS_SDK_400_INVALID_QUERY) as any,
    );
    const svc = new QueryService(base);

    await expect(svc.executeQuery("SELECT 1", "mybucket")).rejects.toThrow(
      /unknown query type/,
    );
  });

  it("404: surfaces error message from SDK HttpError", async () => {
    const base = stubBaseService(InfluxProductType.CloudServerless);
    vi.mocked(base.getClient).mockReturnValue(
      sdkClientThrowing(SERVERLESS_SDK_404_NONEXISTENT_BUCKET) as any,
    );
    const svc = new QueryService(base);

    await expect(svc.executeQuery("SELECT 1", "nonexistent")).rejects.toThrow(
      /could not find bucket/,
    );
  });
});

describe("handleQueryError – Serverless {code,message} via axios path", () => {
  // These test the data.message extraction added to handleQueryError.
  // Before the fix, data.error was undefined (field is "message"),
  // so errors fell through to statusText ("Bad Request" / "Not Found").

  it("400: surfaces message from {code, message} JSON response", async () => {
    const base = stubBaseService(InfluxProductType.Core);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(SERVERLESS_AXIOS_400_INVALID_QUERY) as any,
    );
    const svc = new QueryService(base);

    await expect(svc.executeQuery("SELECT 1", "mydb")).rejects.toThrow(
      /unknown query type/,
    );
  });

  it("404: surfaces message from {code, message} JSON response", async () => {
    const base = stubBaseService(InfluxProductType.Core);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET) as any,
    );
    const svc = new QueryService(base);

    await expect(svc.executeQuery("SELECT 1", "nonexistent")).rejects.toThrow(
      /could not find bucket/,
    );
  });
});

describe("v1 /query statement errors returned with HTTP 200", () => {
  function serviceWhoseQueryEndpointAnswers(
    type: InfluxProductType,
    answer: { body?: unknown; error?: unknown },
  ) {
    const base = stubBaseService(type);
    const get =
      answer.error === undefined
        ? vi.fn().mockResolvedValue(answer.body)
        : vi.fn().mockRejectedValue(answer.error);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue({ get } as any);
    return new QueryService(base);
  }

  it("Cloud Serverless: says the bucket needs a DBRP mapping and that query_sql reads it", async () => {
    const svc = serviceWhoseQueryEndpointAnswers(
      InfluxProductType.CloudServerless,
      { body: SERVERLESS_V1_QUERY_200_BUCKET_WITHOUT_DBRP },
    );

    const error = await svc
      .executeInfluxqlQuery("SELECT count(v) FROM dup", "mybucket")
      .catch((thrown) => thrown);

    expect(error.code).toBe("influxql_bucket_not_mapped");
    expect(error.recovery).toBe("none");
    expect(error.message).toContain("database not found: mybucket");
    expect(error.message).toMatch(
      /bucket 'mybucket' doesn't exist, or it has no DBRP mapping/,
    );
    expect(error.message).toMatch(/list_databases/);
    expect(error.message).toMatch(/query_sql/);
    expect(error.message).toMatch(/POST \/api\/v2\/dbrps/);
    expect(error.message).toMatch(/retention_policy .*\(required\)/);
    expect(error.message).toMatch(/default: true/);
  });

  it("Cloud Serverless: leaves an HTTP error that isn't about the mapping as it is", async () => {
    const svc = serviceWhoseQueryEndpointAnswers(
      InfluxProductType.CloudServerless,
      { error: SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET },
    );

    const error = await svc
      .executeInfluxqlQuery("SELECT * FROM m", "nonexistent")
      .catch((thrown) => thrown);

    expect(error.code).not.toBe("influxql_bucket_not_mapped");
    expect(error.message).not.toMatch(/DBRP/);
  });

  it.each([
    ["Cloud Dedicated", InfluxProductType.CloudDedicated],
    ["Clustered", InfluxProductType.Clustered],
  ])(
    "%s: raises a statement error as a failed query, not as one row",
    async (_product, type) => {
      const svc = serviceWhoseQueryEndpointAnswers(type, {
        body: SERVERLESS_V1_QUERY_200_BUCKET_WITHOUT_DBRP,
      });

      const error = await svc
        .executeInfluxqlQuery("SELECT * FROM m", "mybucket")
        .catch((thrown) => thrown);

      expect(error.code).toBe("query_failed");
      expect(error.message).toBe("database not found: mybucket");
    },
  );

  it("Cloud Dedicated: SHOW MEASUREMENTS fails instead of returning an empty list", async () => {
    const svc = serviceWhoseQueryEndpointAnswers(
      InfluxProductType.CloudDedicated,
      { body: SERVERLESS_V1_QUERY_200_BUCKET_WITHOUT_DBRP },
    );

    const error = await svc.getMeasurements("mybucket").catch((t) => t);

    expect(error.code).toBe("metadata_unavailable");
    expect(error.message).toContain("database not found");
  });

  it("returns a body without statement errors unchanged", async () => {
    const body = {
      results: [
        {
          statement_id: 0,
          series: [{ name: "m", columns: ["time", "v"], values: [[1, 2]] }],
        },
      ],
    };
    const svc = serviceWhoseQueryEndpointAnswers(
      InfluxProductType.CloudDedicated,
      { body },
    );

    await expect(
      svc.executeInfluxqlQuery("SELECT * FROM m", "mybucket"),
    ).resolves.toEqual(body);
  });
});
