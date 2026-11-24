import { describe, expect, it } from "vitest";
import { resolveWriteError } from "../src/services/error-resolution.service.js";
import {
  CLOUD_DEDICATED_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
  CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
  SYNTHETIC_400_V2_PARTIAL_WRITE_TWO_LINES,
  V2_PARTIAL_WRITE_BATCH,
  V2_PARTIAL_WRITE_REJECTION,
} from "./fixtures/write-errors-v2-partial-write.js";
import { CORE_ENT_400_V2_DUPLICATE_TAG_WHOLE_BATCH } from "./fixtures/write-errors-3.12.2.js";

const v2Write = (lineProtocol: string) => ({ lineProtocol });

describe("an /api/v2/write partial write on Cloud Dedicated and Cloud Serverless", () => {
  it.each([
    ["Cloud Dedicated", CLOUD_DEDICATED_400_V2_PARTIAL_WRITE_DUPLICATE_TAG],
    ["Cloud Serverless", CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG],
  ])(
    "%s: names the rejected line and says the rest were stored",
    (_product, recorded) => {
      const error = resolveWriteError(
        recorded,
        "db",
        v2Write(V2_PARTIAL_WRITE_BATCH),
      );
      expect(error.code).toBe("write_lines_rejected");
      expect(error.recovery).toBe("none");
      expect(error.status).toBe(400);
      expect(error.write).toMatchObject({
        stored: "some",
        lines_submitted: 2,
        lines_rejected: 1,
        rejected_lines: [
          { line_number: 2, error_message: V2_PARTIAL_WRITE_REJECTION },
        ],
      });
      expect(error.write).not.toHaveProperty("accept_partial");
      expect(error.fix).toMatch(/resend only the rejected lines/);
    },
  );

  it("recognizes the partial write from the body when the header is missing", () => {
    const { headers: _headers, ...withoutHeader } =
      CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG;
    const error = resolveWriteError(
      withoutHeader,
      "db",
      v2Write(V2_PARTIAL_WRITE_BATCH),
    );
    expect(error.code).toBe("write_lines_rejected");
    expect(error.write?.stored).toBe("some");
  });

  it("splits a message that lists more than one rejected line", () => {
    const error = resolveWriteError(
      SYNTHETIC_400_V2_PARTIAL_WRITE_TWO_LINES,
      "db",
      v2Write("a v=1 1\nb v= 2\nc v= 3"),
    );
    expect(error.write?.rejected_lines).toEqual([
      { line_number: 2, error_message: "first problem" },
      { line_number: 3, error_message: "second problem" },
    ]);
    expect(error.write?.stored).toBe("some");
  });

  it("leaves stored unknown when the message names no rejected line", () => {
    const error = resolveWriteError(
      {
        ...CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
        json: { code: "invalid", message: "some points were rejected" },
      },
      "db",
      v2Write("a v=1 1\nb v=2 2\nc v=3 3"),
    );
    expect(error.code).toBe("write_lines_rejected");
    expect(error.write?.stored).toBe("unknown");
    expect(error.fix).not.toMatch(/resend only the rejected lines/);
    expect(error.fix).toMatch(/Check which lines were stored/);
  });

  it("says nothing was stored when every line was rejected", () => {
    const error = resolveWriteError(
      CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG,
      "db",
      v2Write("dup,host=a,host=b v=1"),
    );
    expect(error.write?.stored).toBe("none");
  });

  it("leaves a Core or Enterprise v2 whole-batch rejection as a failed write", () => {
    const error = resolveWriteError(
      CORE_ENT_400_V2_DUPLICATE_TAG_WHOLE_BATCH,
      "db",
      v2Write(V2_PARTIAL_WRITE_BATCH),
    );
    expect(error.code).toBe("write_failed");
    expect(error.write).toBeUndefined();
    expect(error.message).toContain("multiple instances of 'host' tag found");
  });
});
