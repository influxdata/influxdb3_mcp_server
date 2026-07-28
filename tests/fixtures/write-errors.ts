/**
 * Write-path error fixtures.
 *
 * Companion to `error-responses.ts`, which covers the query path. Shapes follow
 * the same two families:
 *
 *   Axios errors (Core/Enterprise/Clustered HTTP paths)
 *     error.response.status, error.response.statusText, error.response.data
 *   SDK HttpError (Cloud Dedicated/Serverless client paths)
 *     error.statusCode, error.statusMessage, error.body, error.json, error.message
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 *
 * RECORDED   Body text observed against a real instance, or carried over from
 *            `error-responses.ts`.
 * PROVISIONAL Body text is a placeholder pending live verification. Tests
 *            using these fixtures must assert on structure and on substrings
 *            the fixture itself defines (`DUPLICATED_TAG_KEY`), never on
 *            exact InfluxDB wording, so that correcting the fixture does not
 *            invalidate the assertion.
 *
 * The duplicate-tag-key response shape is resolved: verified 2026-07-28
 * against both an Enterprise instance (`--upgrade-pacha-tree`, 3.11.0-0.rc.1)
 * and a Core instance (3.11.0-nightly) — identical response on both. See
 * `CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA` below.
 *
 * Whether a stopped node makes `write_lp` return 503 (instead of the current
 * 400) remains unverified — needs a live instance with a node stopped
 * mid-write. See `CORE_503_NODE_STOPPED` below.
 */

import type { AxiosErrorShape, SdkErrorShape } from "./error-responses.js";

export type { AxiosErrorShape, SdkErrorShape };

// ── The 3.11 duplicate-tag-key case ─────────────────────────────────────────
//
// 3.11 rejects a line carrying the same tag key twice up front, the same way
// duplicate field keys were already refused. The rejection needs to reach the
// model naming the duplicated tag, not just as a generic "bad request."

/**
 * Line protocol that 3.11 rejects: the same tag key appears twice.
 *
 * A one-letter tag key (e.g. `m,t=a,t=a f=1i`) is not usable in an assertion —
 * `not.toContain("t")` matches ordinary English in the generic error string
 * and passes for the wrong reason — so the fixture uses a distinctive key
 * instead. The condition under test is identical.
 */
export const DUPLICATE_TAG_LINE = "m,region=east,region=west f=1i";

/** The tag key duplicated in {@link DUPLICATE_TAG_LINE}. */
export const DUPLICATED_TAG_KEY = "region";

/**
 * RECORDED — duplicated tag named only inside the partial-write
 * `data[].error_message` structure.
 *
 * Verified 2026-07-28 against both Core (3.11.0-nightly) and Enterprise
 * (3.11.0-0.rc.1, `--upgrade-pacha-tree`) — identical on both. `data.error`
 * resolves to the generic "partial write of line protocol occurred" and the
 * actionable detail is one level down, under `data[].error_message`. The MCP
 * server sends `accept_partial=true` on the Core/Enterprise v3 path, so this
 * is the shape a real rejection takes; resolving `data.error` alone is not
 * sufficient. `original_line` is truncated by InfluxDB itself, mid tag value —
 * not something our code does.
 */
export const CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "partial write of line protocol occurred",
      data: [
        {
          error_message: `invalid line protocol - multiple instances of '${DUPLICATED_TAG_KEY}' tag found`,
          line_number: 1,
          original_line: "m,region=east,region",
        },
      ],
    },
  },
  message: "Request failed with status code 400",
};

// ── Status arms that currently discard the body ─────────────────────────────

/** RECORDED — Core rejects an unauthenticated request with this exact text. */
export const CORE_401_UNAUTHENTICATED: AxiosErrorShape = {
  response: {
    status: 401,
    statusText: "Unauthorized",
    data: { error: "the request was not authenticated" },
  },
  message: "Request failed with status code 401",
};

/** PROVISIONAL — permission-scoped token refused by the write endpoint. */
export const CORE_403_UNAUTHORIZED: AxiosErrorShape = {
  response: {
    status: 403,
    statusText: "Forbidden",
    data: { error: "the request was not authorized" },
  },
  message: "Request failed with status code 403",
};

/** PROVISIONAL — body exceeds the configured limit. Plain-text body. */
export const CORE_413_PAYLOAD_TOO_LARGE: AxiosErrorShape = {
  response: {
    status: 413,
    statusText: "Payload Too Large",
    data: "the request body was too large: limit is 10485760 bytes",
  },
  message: "Request failed with status code 413",
};

/** PROVISIONAL — line protocol parsed but semantically rejected. */
export const CORE_422_UNPROCESSABLE: AxiosErrorShape = {
  response: {
    status: 422,
    statusText: "Unprocessable Entity",
    data: {
      error:
        "invalid column type for column 'value', expected iox::column_type::field::float, got iox::column_type::field::string",
    },
  },
  message: "Request failed with status code 422",
};

// ── 503 — the status neither handler has an arm for ─────────────────────────

/**
 * PROVISIONAL — a stopped node.
 *
 * InfluxDB 3.11's release notes (Core/Enterprise-scoped) document a 400→503
 * change for the legacy `/api/v2/write` endpoint that Core/Enterprise also
 * expose for backward compatibility — not the `/api/v3/write_lp` endpoint
 * this server actually calls for those product types. Whether
 * `/api/v3/write_lp` behaves the same on a stopped node is unverified,
 * answerable only on a live instance with a node stopped mid-write. The
 * fixture exists so the handler's 503 arm is testable either way — the arm is
 * also needed for the separate `Clustered` product (InfluxDB Clustered, the
 * self-hosted sibling to Cloud Dedicated — not a multi-node Enterprise
 * deployment), which does call `/api/v2/write` (see `write-routing.test.ts`).
 * That's unrelated to these Core/Enterprise release notes: `Clustered` is a
 * different product on its own release train.
 */
export const CORE_503_NODE_STOPPED: AxiosErrorShape = {
  response: {
    status: 503,
    statusText: "Service Unavailable",
    data: { error: "node is stopped and not accepting writes" },
  },
  message: "Request failed with status code 503",
};

// ── Object-body fallback ────────────────────────────────────────────────────

/**
 * RECORDED shape, unhandled status.
 *
 * Any status with no arm falls through to a fallback that interpolates
 * `error.response.data` directly. When the body is parsed JSON — the normal
 * case — the model receives `[object Object]`.
 */
export const CORE_500_OBJECT_BODY: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: { error: "internal error while persisting write" },
  },
  message: "Request failed with status code 500",
};

/** RECORDED shape — plain-text body on an unhandled status, which does survive. */
export const CORE_500_STRING_BODY: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: "internal error while persisting write",
  },
  message: "Request failed with status code 500",
};

// ── Cloud SDK (HttpError) write failures ────────────────────────────────────
//
// `@influxdata/influxdb3-client` throws `HttpError`, which carries `statusCode`
// rather than `response.status`. Every status branch in the write handler tests
// `error.response?.status` and therefore misses on these entirely.

/** PROVISIONAL — Cloud rejection of {@link DUPLICATE_TAG_LINE}. */
export const CLOUD_SDK_400_DUPLICATE_TAG: SdkErrorShape = {
  statusCode: 400,
  statusMessage: "Bad Request",
  body: `{"code":"invalid","message":"invalid line protocol: duplicate tag key '${DUPLICATED_TAG_KEY}' on line 1"}`,
  json: {
    code: "invalid",
    message: `invalid line protocol: duplicate tag key '${DUPLICATED_TAG_KEY}' on line 1`,
  },
  message: `invalid line protocol: duplicate tag key '${DUPLICATED_TAG_KEY}' on line 1`,
};

/** RECORDED shape — Cloud rejects an invalid token. */
export const CLOUD_SDK_401_UNAUTHORIZED: SdkErrorShape = {
  statusCode: 401,
  statusMessage: "Unauthorized",
  body: '{"code":"unauthorized","message":"unauthorized access"}',
  json: { code: "unauthorized", message: "unauthorized access" },
  message: "unauthorized access",
};

/** PROVISIONAL — Cloud write rejected while a node is unavailable. */
export const CLOUD_SDK_503_UNAVAILABLE: SdkErrorShape = {
  statusCode: 503,
  statusMessage: "Service Unavailable",
  body: '{"code":"unavailable","message":"service temporarily unavailable"}',
  json: { code: "unavailable", message: "service temporarily unavailable" },
  message: "service temporarily unavailable",
};
