import { describe, it, expect } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { writeErrorMessage } from "./helpers/write-service.js";
import {
  CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA,
  CORE_401_UNAUTHENTICATED,
  CORE_403_UNAUTHORIZED,
  CORE_413_PAYLOAD_TOO_LARGE,
  CORE_422_UNPROCESSABLE,
  CORE_500_OBJECT_BODY,
  CORE_500_STRING_BODY,
  SYNTHETIC_503_WITHOUT_BODY,
  DUPLICATE_TAG_LINE,
  DUPLICATED_TAG_KEY,
} from "./fixtures/write-errors.js";

const http = (error: unknown) => ({ kind: "http" as const, error });

async function coreWriteError(
  error: unknown,
  lineProtocol?: string,
): Promise<string> {
  return writeErrorMessage(InfluxProductType.Core, http(error), lineProtocol);
}

describe("handleWriteError preserves the InfluxDB error body, resolving data[].error_message, data.error_message, data.message, data.error, a string body, then error.message", () => {
  it("400: the duplicated tag key nested under data[].error_message (Core 3.11.0-nightly, Enterprise 3.11.0-0.rc.1) is returned, not the generic partial-write text", async () => {
    const message = await coreWriteError(
      CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA,
      DUPLICATE_TAG_LINE,
    );

    expect(message).toMatch(/^Bad request: /);
    expect(message).toContain(DUPLICATED_TAG_KEY);
    expect(message).toMatch(/multiple instances/i);
    expect(message).not.toBe(
      "Bad request: partial write of line protocol occurred",
    );
  });

  it("401: the InfluxDB body survives", async () => {
    const message = await coreWriteError(CORE_401_UNAUTHENTICATED);

    expect(message).toMatch(/^Unauthorized: /);
    expect(message).toContain("the request was not authenticated");
  });

  it("403: the InfluxDB body survives", async () => {
    const message = await coreWriteError(CORE_403_UNAUTHORIZED);

    expect(message).toMatch(/^Access denied or not found: /);
    expect(message).toContain("the request was not authorized");
  });

  it("413: the actual size limit survives", async () => {
    const message = await coreWriteError(CORE_413_PAYLOAD_TOO_LARGE);

    expect(message).toMatch(/^Request entity too large: /);
    expect(message).toContain("10485760");
  });

  it("422: the offending column survives", async () => {
    const message = await coreWriteError(CORE_422_UNPROCESSABLE);

    expect(message).toMatch(/^Unprocessable entity: /);
    expect(message).toContain("invalid column type for column 'value'");
  });

  it("applies identically on Enterprise", async () => {
    const message = await writeErrorMessage(
      InfluxProductType.Enterprise,
      http(CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA),
      DUPLICATE_TAG_LINE,
    );

    expect(message).toMatch(/^Bad request: /);
    expect(message).toContain(DUPLICATED_TAG_KEY);
  });
});

describe("handleWriteError adds a 503 arm and serializes bodies", () => {
  it("503: is phrased as retryable and distinguishable from a bad request", async () => {
    const message = await coreWriteError(SYNTHETIC_503_WITHOUT_BODY);

    expect(message).toMatch(/retry|temporar|again/i);
    expect(message).not.toMatch(/^Bad request: /);
  });

  it("fallback serializes a parsed JSON body instead of interpolating it", async () => {
    const message = await coreWriteError(CORE_500_OBJECT_BODY);

    expect(message).not.toContain("[object Object]");
    expect(message).toContain("internal error while persisting write");
  });

  it("fallback still preserves a plain-text body unchanged", async () => {
    const message = await coreWriteError(CORE_500_STRING_BODY);

    expect(message).toContain("internal error while persisting write");
    expect(message).not.toContain("[object Object]");
  });
});
