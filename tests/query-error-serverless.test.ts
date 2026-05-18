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
  return { post: vi.fn().mockRejectedValue(error) };
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

    await expect(
      svc.executeQuery("SELECT 1", "mybucket"),
    ).rejects.toThrow(/unknown query type/);
  });

  it("404: surfaces error message from SDK HttpError", async () => {
    const base = stubBaseService(InfluxProductType.CloudServerless);
    vi.mocked(base.getClient).mockReturnValue(
      sdkClientThrowing(SERVERLESS_SDK_404_NONEXISTENT_BUCKET) as any,
    );
    const svc = new QueryService(base);

    await expect(
      svc.executeQuery("SELECT 1", "nonexistent"),
    ).rejects.toThrow(/could not find bucket/);
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

    await expect(
      svc.executeQuery("SELECT 1", "mydb"),
    ).rejects.toThrow(/unknown query type/);
  });

  it("404: surfaces message from {code, message} JSON response", async () => {
    const base = stubBaseService(InfluxProductType.Core);
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET) as any,
    );
    const svc = new QueryService(base);

    await expect(
      svc.executeQuery("SELECT 1", "nonexistent"),
    ).rejects.toThrow(/could not find bucket/);
  });
});
