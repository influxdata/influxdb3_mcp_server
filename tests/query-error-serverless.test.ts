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
  SERVERLESS_AXIOS_INFLUXQL_BUCKET_WITHOUT_DBRP,
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

describe("Cloud Serverless InfluxQL on a bucket without a DBRP mapping", () => {
  function serviceWhoseQueryEndpointFails(error: AxiosErrorShape) {
    const base = stubBaseService(InfluxProductType.CloudServerless);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue({
      get: vi.fn().mockRejectedValue(error),
    } as any);
    return new QueryService(base);
  }

  it("says the bucket needs a DBRP mapping and that query_sql reads it", async () => {
    const svc = serviceWhoseQueryEndpointFails(
      SERVERLESS_AXIOS_INFLUXQL_BUCKET_WITHOUT_DBRP,
    );

    const error = await svc
      .executeInfluxqlQuery("SELECT * FROM m", "mybucket")
      .catch((thrown) => thrown);

    expect(error.code).toBe("influxql_bucket_not_mapped");
    expect(error.recovery).toBe("none");
    expect(error.status).toBe(404);
    expect(error.message).toContain("database not found");
    expect(error.message).toMatch(/DBRP mapping for bucket 'mybucket'/);
    expect(error.message).toMatch(/query_sql/);
  });

  it("leaves other InfluxQL errors as they are", async () => {
    const svc = serviceWhoseQueryEndpointFails(
      SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET,
    );

    const error = await svc
      .executeInfluxqlQuery("SELECT * FROM m", "nonexistent")
      .catch((thrown) => thrown);

    expect(error.code).not.toBe("influxql_bucket_not_mapped");
    expect(error.message).not.toMatch(/DBRP/);
  });

  it("doesn't change Cloud Dedicated's InfluxQL errors", async () => {
    const base = stubBaseService(InfluxProductType.CloudDedicated);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue({
      get: vi
        .fn()
        .mockRejectedValue(SERVERLESS_AXIOS_INFLUXQL_BUCKET_WITHOUT_DBRP),
    } as any);
    const error = await new QueryService(base)
      .executeInfluxqlQuery("SELECT * FROM m", "mybucket")
      .catch((thrown) => thrown);

    expect(error.code).not.toBe("influxql_bucket_not_mapped");
  });
});
