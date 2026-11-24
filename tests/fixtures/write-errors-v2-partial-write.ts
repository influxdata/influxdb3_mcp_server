import type { SdkErrorShape } from "./error-responses.js";

export const V2_PARTIAL_WRITE_VALID_LINE = "ok,host=a v=1 1700000000";
export const V2_PARTIAL_WRITE_DUPLICATE_TAG_LINE = "dup,host=a,host=b v=1";
export const V2_PARTIAL_WRITE_BATCH = [
  V2_PARTIAL_WRITE_VALID_LINE,
  V2_PARTIAL_WRITE_DUPLICATE_TAG_LINE,
].join("\n");
export const V2_PARTIAL_WRITE_REJECTION =
  "the tag 'host' is specified more than once in a single line";

const partialWrite400 = (json: Record<string, unknown>): SdkErrorShape => ({
  statusCode: 400,
  statusMessage: "Bad Request",
  body: JSON.stringify(json),
  json,
  message: String(json.message),
  headers: {
    "content-type": "application/json",
    "influxdata-partial-write": "true",
  },
});

const RECORDED_DUPLICATE_TAG_BODY = {
  code: "invalid",
  message: `partial write has occurred, errors encountered on line(s): line 2: ${V2_PARTIAL_WRITE_REJECTION}`,
  line: 2,
};

/** Recorded on Cloud Dedicated `/api/v2/write`, claim 20261123-0037. */
export const CLOUD_DEDICATED_400_V2_PARTIAL_WRITE_DUPLICATE_TAG =
  partialWrite400(RECORDED_DUPLICATE_TAG_BODY);

/** Recorded on Cloud Serverless `/api/v2/write`, claim 20261123-0038. */
export const CLOUD_SERVERLESS_400_V2_PARTIAL_WRITE_DUPLICATE_TAG =
  partialWrite400(RECORDED_DUPLICATE_TAG_BODY);

/** SYNTHETIC. Two rejected lines; no response with more than one is recorded. */
export const SYNTHETIC_400_V2_PARTIAL_WRITE_TWO_LINES = partialWrite400({
  code: "invalid",
  message:
    "partial write has occurred, errors encountered on line(s): line 2: first problem, line 3: second problem",
  line: 2,
});
