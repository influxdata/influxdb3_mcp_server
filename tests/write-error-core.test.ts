/**
 * Write-path error fidelity — Core / Enterprise (axios transport).
 *
 * Covers two fixes needed in `handleWriteError`: preserving InfluxDB's error
 * body instead of discarding it, and adding a 503 arm so retryable failures
 * don't render as `[object Object]`. Mirrors `query-error-core.test.ts`,
 * which already does this correctly on the query path — the pattern this
 * file asks the write path to adopt.
 *
 * ── How to read this file ───────────────────────────────────────────────────
 *
 * The `current behavior` blocks are active and passing. They pin down exactly
 * what the model sees today, so the defect is described by an executable
 * assertion rather than by prose.
 *
 * The two `describe.skip(...)` blocks below are the acceptance criteria for
 * the fix: un-skip them when implementing, and the paired characterization
 * test above will go red at the same moment — that pairing is deliberate, it
 * forces the stale characterization to be deleted rather than left behind.
 */

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
  CORE_503_NODE_STOPPED,
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

describe("handleWriteError – Core/Enterprise – current behavior", () => {
  // Impact map 1.1: a duplicate-tag-key rejection must reach the model naming
  // the tag. Today the 400 arm throws a fixed string and drops the body, so it
  // does not. Verified shape (Core 3.11.0-nightly and Enterprise 3.11.0-0.rc.1,
  // 2026-07-28): the tag name is nested under data[].error_message.
  it("400: discards the duplicate-tag-key body reported under data[].error_message", async () => {
    const message = await coreWriteError(
      CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA,
      DUPLICATE_TAG_LINE,
    );

    expect(message).toBe(
      "Bad request: Invalid line protocol format or parameters",
    );
    expect(message).not.toContain(DUPLICATED_TAG_KEY);
    expect(message).not.toMatch(/multiple instances/i);
  });

  it("401: discards the InfluxDB body", async () => {
    const message = await coreWriteError(CORE_401_UNAUTHENTICATED);

    expect(message).toBe("Unauthorized: Check your InfluxDB token permissions");
    expect(message).not.toContain("not authenticated");
  });

  it("403: discards the InfluxDB body", async () => {
    const message = await coreWriteError(CORE_403_UNAUTHORIZED);

    expect(message).toBe(
      "Access denied: Insufficient permissions for database operations",
    );
    expect(message).not.toContain("not authorized");
  });

  it("413: discards the InfluxDB body, including the actual limit", async () => {
    const message = await coreWriteError(CORE_413_PAYLOAD_TOO_LARGE);

    expect(message).toBe(
      "Request entity too large: Reduce the size of your line protocol data",
    );
    expect(message).not.toContain("10485760");
  });

  it("422: discards the InfluxDB body, including the offending column", async () => {
    const message = await coreWriteError(CORE_422_UNPROCESSABLE);

    expect(message).toBe("Unprocessable entity: Invalid line protocol syntax");
    expect(message).not.toContain("value");
  });

  it("503: has no arm, so it falls through to the fallback", async () => {
    const message = await coreWriteError(CORE_503_NODE_STOPPED);

    expect(message).toMatch(/^Failed to write data to database 'mydb':/);
    // Nothing tells the model this is worth retrying.
    expect(message).not.toMatch(/retry|temporar|again/i);
  });

  it("fallback renders a parsed JSON body as [object Object]", async () => {
    const message = await coreWriteError(CORE_500_OBJECT_BODY);

    expect(message).toBe(
      "Failed to write data to database 'mydb': [object Object]",
    );
    expect(message).not.toContain("persisting write");
  });

  // A no-regression guard, not a new requirement: this one already passes and
  // must keep passing after the fallback's body-rendering changes.
  it("fallback does preserve a plain-text body", async () => {
    // The one path that already works: `data` is a string, so interpolating it
    // is lossless. Recorded so the fix is not credited with more than it
    // changes.
    const message = await coreWriteError(CORE_500_STRING_BODY);

    expect(message).toBe(
      "Failed to write data to database 'mydb': internal error while persisting write",
    );
  });

  it("applies identically on Enterprise", async () => {
    const message = await writeErrorMessage(
      InfluxProductType.Enterprise,
      http(CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA),
      DUPLICATE_TAG_LINE,
    );

    expect(message).toBe(
      "Bad request: Invalid line protocol format or parameters",
    );
  });
});

// ── Acceptance criteria for the fix ─────────────────────────────────────────

describe.skip("handleWriteError preserves the InfluxDB error body", () => {
  // Un-skip when implemented. The expected resolution order is the one
  // `handleQueryError` already uses:
  //   data.message → data.error → string body → statusText → error.message

  // Verified shape (Core 3.11.0-nightly and Enterprise 3.11.0-0.rc.1,
  // 2026-07-28): the tag name is nested under data[].error_message, not
  // data.error or data.message. Resolving data.error alone is not enough —
  // it yields the generic "partial write of line protocol occurred" and the
  // actionable detail stays buried one level down.
  it("400: the duplicated tag key reaches the model", async () => {
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

    expect(message).toMatch(/^Access denied: /);
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
});

describe.skip("handleWriteError adds a 503 arm and serializes bodies", () => {
  it("503: is phrased as retryable and distinguishable from a bad request", async () => {
    const message = await coreWriteError(CORE_503_NODE_STOPPED);

    expect(message).toMatch(/retry|temporar|again/i);
    expect(message).not.toMatch(/^Bad request: /);
    expect(message).toContain("node is stopped");
  });

  it("fallback serializes a parsed JSON body instead of interpolating it", async () => {
    const message = await coreWriteError(CORE_500_OBJECT_BODY);

    expect(message).not.toContain("[object Object]");
    expect(message).toContain("internal error while persisting write");
  });

  // A no-regression guard, not a new requirement: cloud-serverless is already
  // correct and must stay that way when the other four types change.
  it("fallback still preserves a plain-text body unchanged", async () => {
    const message = await coreWriteError(CORE_500_STRING_BODY);

    expect(message).toContain("internal error while persisting write");
    expect(message).not.toContain("[object Object]");
  });
});
