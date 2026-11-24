import { describe, it, expect } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { writeErrorMessage } from "./helpers/write-service.js";
import {
  CLOUD_SDK_401_UNAUTHORIZED,
  CLOUD_SDK_503_UNAVAILABLE,
} from "./fixtures/write-errors.js";
import {
  CLOUD_DEDICATED_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
  CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
  V2_PARTIAL_WRITE_BATCH,
  V2_PARTIAL_WRITE_REJECTION,
} from "./fixtures/write-errors-v2-partial-write.js";

const CLOUD_TYPES = [
  ["cloud-dedicated", InfluxProductType.CloudDedicated],
  ["cloud-serverless", InfluxProductType.CloudServerless],
] as const;

const sdk = (error: unknown) => ({ kind: "sdk" as const, error });

describe("client library HttpError reaches the same status handling as axios", () => {
  it.each([
    [
      "cloud-dedicated",
      InfluxProductType.CloudDedicated,
      CLOUD_DEDICATED_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
    ],
    [
      "cloud-serverless",
      InfluxProductType.CloudServerless,
      CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
    ],
  ] as const)(
    "%s: a 400 reaches the 400 arm",
    async (_label, type, recorded) => {
      const message = await writeErrorMessage(
        type,
        sdk(recorded),
        V2_PARTIAL_WRITE_BATCH,
      );

      expect(message).toMatch(/^Bad request: /);
      expect(message).toContain(V2_PARTIAL_WRITE_REJECTION);
    },
  );

  it.each(CLOUD_TYPES)(
    "%s: a 401 reaches the 401 arm",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_401_UNAUTHORIZED),
      );

      expect(message).toMatch(/^Unauthorized: /);
      expect(message).toContain("unauthorized access");
    },
  );

  it.each(CLOUD_TYPES)(
    "%s: a 503 reaches the retryable arm, not the generic or 400 arm whose text the SDK message could match",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_503_UNAVAILABLE),
      );

      expect(message).not.toMatch(/^Failed to write data to database /);
      expect(message).not.toMatch(/^Bad request: /);
      expect(message).toMatch(/retry|temporar|again/i);
    },
  );

  it("resolves the body from HttpError.json, not only HttpError.message", async () => {
    const message = await writeErrorMessage(
      InfluxProductType.CloudServerless,
      sdk({
        ...CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
        message: "Request failed",
      }),
      V2_PARTIAL_WRITE_BATCH,
    );

    expect(message).toContain(V2_PARTIAL_WRITE_REJECTION);
    expect(message).not.toBe(
      "Failed to write data to database 'mydb': Request failed",
    );
  });
});
