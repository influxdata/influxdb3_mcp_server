/**
 * Write-path error fidelity — Cloud Dedicated / Cloud Serverless (SDK transport).
 *
 * Covers normalizing the cloud SDK's error shape so it reaches the same
 * status-handling code as the Core/Enterprise axios path.
 *
 * `@influxdata/influxdb3-client` throws `HttpError`, which carries `statusCode`
 * — not `error.response.status`. `handleWriteError` now normalizes both
 * shapes to one internal form (`normalizeError`) before branching, so these
 * two product types reach the same status arms as Core/Enterprise.
 */

import { describe, it, expect } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { writeErrorMessage } from "./helpers/write-service.js";
import {
  CLOUD_SDK_400_DUPLICATE_TAG,
  CLOUD_SDK_401_UNAUTHORIZED,
  CLOUD_SDK_503_UNAVAILABLE,
  DUPLICATE_TAG_LINE,
  DUPLICATED_TAG_KEY,
} from "./fixtures/write-errors.js";

const CLOUD_TYPES = [
  ["cloud-dedicated", InfluxProductType.CloudDedicated],
  ["cloud-serverless", InfluxProductType.CloudServerless],
] as const;

const sdk = (error: unknown) => ({ kind: "sdk" as const, error });

describe("cloud SDK errors are normalized before branching", () => {
  // Un-skip when the cloud SDK error shape is normalized. Expected: both
  // `error.response.status` and `error.statusCode` resolve to one internal
  // status, and both `error.response.data` and `error.body` / `error.json`
  // resolve to one body, before any status branch runs.

  it.each(CLOUD_TYPES)(
    "%s: a 400 reaches the 400 arm",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_400_DUPLICATE_TAG),
        DUPLICATE_TAG_LINE,
      );

      expect(message).toMatch(/^Bad request: /);
      expect(message).toContain(DUPLICATED_TAG_KEY);
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
    "%s: a 503 reaches the retryable arm",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_503_UNAVAILABLE),
      );

      // Assert on the classification, not on body text: the SDK's own message
      // for this fixture happens to read "temporarily unavailable", so a
      // substring check alone would pass today for the wrong reason.
      expect(message).not.toMatch(/^Failed to write data to database /);
      expect(message).not.toMatch(/^Bad request: /);
      expect(message).toMatch(/retry|temporar|again/i);
    },
  );

  it("resolves the body from HttpError.json, not only HttpError.message", async () => {
    // `message` is a convenience the SDK derives; `json` / `body` are the
    // response. Normalizing on the response keeps the two transports resolving
    // the same field, which is the point of extracting a shared error-body
    // resolver instead of letting the two handlers drift apart.
    const message = await writeErrorMessage(
      InfluxProductType.CloudServerless,
      sdk({ ...CLOUD_SDK_400_DUPLICATE_TAG, message: "Request failed" }),
      DUPLICATE_TAG_LINE,
    );

    expect(message).toContain(DUPLICATED_TAG_KEY);
    expect(message).not.toBe(
      "Failed to write data to database 'mydb': Request failed",
    );
  });
});
