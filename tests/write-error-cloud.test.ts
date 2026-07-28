/**
 * Write-path error fidelity — Cloud Dedicated / Cloud Serverless (SDK transport).
 *
 * Covers patch item P4 (normalize the cloud SDK error shape).
 *
 * `@influxdata/influxdb3-client` throws `HttpError`, which carries `statusCode`
 * — not `error.response.status`. Every status branch in `handleWriteError`
 * tests `error.response?.status`, so on these two product types no branch is
 * ever reached and every failure lands in the fallback.
 *
 * Strictly outside the Core/Enterprise scope of the 3.11 patch, but it is the
 * same function P1 and P2 rewrite: leaving it means those fixes only half-land.
 *
 * See `write-error-core.test.ts` for how the characterization / `[P*]` split
 * works.
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

describe("handleWriteError – Cloud SDK shape – current behavior", () => {
  it.each(CLOUD_TYPES)(
    "%s: a 400 never reaches the 400 arm",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_400_DUPLICATE_TAG),
        DUPLICATE_TAG_LINE,
      );

      // The generic fallback, not the status arm.
      expect(message).toMatch(/^Failed to write data to database 'mydb': /);
      expect(message).not.toMatch(/^Bad request: /);
    },
  );

  it.each(CLOUD_TYPES)(
    "%s: a 401 never reaches the 401 arm",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_401_UNAUTHORIZED),
      );

      expect(message).toMatch(/^Failed to write data to database 'mydb': /);
      expect(message).not.toMatch(/^Unauthorized: /);
    },
  );

  it.each(CLOUD_TYPES)(
    "%s: a 503 is not distinguishable as retryable",
    async (_label, type) => {
      const message = await writeErrorMessage(
        type,
        sdk(CLOUD_SDK_503_UNAVAILABLE),
      );

      expect(message).toMatch(/^Failed to write data to database 'mydb': /);
      // The SDK's own message happens to say "temporarily unavailable", but
      // nothing in the handler classifies it — a 503 and a 400 are rendered
      // with the same prefix, which is the distinction P2 exists to restore.
      expect(message).not.toMatch(/^Service unavailable/i);
    },
  );

  it("the SDK's message text does survive, unlike the axios path", async () => {
    // Worth recording: on the cloud paths the fallback interpolates
    // `error.message`, which HttpError populates from the response body. So
    // the body is not lost here — it is the *classification* that is lost.
    const message = await writeErrorMessage(
      InfluxProductType.CloudServerless,
      sdk(CLOUD_SDK_400_DUPLICATE_TAG),
      DUPLICATE_TAG_LINE,
    );

    expect(message).toContain(DUPLICATED_TAG_KEY);
  });
});

describe.skip("[P4] cloud SDK errors are normalized before branching", () => {
  // Un-skip when P4 lands. Expected: both `error.response.status` and
  // `error.statusCode` resolve to one internal status, and both
  // `error.response.data` and `error.body` / `error.json` resolve to one body,
  // before any status branch runs.

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
    // the same field, which is the point of the shared helper P1 recommends.
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
