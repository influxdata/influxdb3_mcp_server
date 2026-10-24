/**
 * Which formats and options each product supports on each query route.
 *
 * Dispatch consults this table before any request, so an unsupported
 * combination is refused with a stable error code instead of being sent,
 * silently dropped, or mislabeled (#84).
 */

import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import type { QueryFormat } from "./query-payload.js";
import type { QueryLanguage } from "./query-safety.service.js";

interface RouteCapabilities {
  formats: readonly QueryFormat[];
  /** Whether a per-query `timeoutMs` reaches the server. */
  timeout: boolean;
}

const ALL_FORMATS: readonly QueryFormat[] = [
  "json",
  "jsonl",
  "csv",
  "pretty",
  "parquet",
];

/** v3 HTTP query API: every format, client-side timeout. */
const V3_HTTP: RouteCapabilities = { formats: ALL_FORMATS, timeout: true };
/** Flight SQL through the client library: rows only, no per-query timeout. */
const FLIGHT: RouteCapabilities = { formats: ["json"], timeout: false };
/** v1-compatible `/query` HTTP API: parsed JSON only. */
const V1_HTTP: RouteCapabilities = { formats: ["json"], timeout: true };

const CAPABILITIES: Record<
  InfluxProductType,
  Record<QueryLanguage, RouteCapabilities>
> = {
  [InfluxProductType.Core]: { sql: V3_HTTP, influxql: V3_HTTP },
  [InfluxProductType.Enterprise]: { sql: V3_HTTP, influxql: V3_HTTP },
  [InfluxProductType.CloudDedicated]: { sql: FLIGHT, influxql: V1_HTTP },
  [InfluxProductType.CloudServerless]: { sql: FLIGHT, influxql: V1_HTTP },
  [InfluxProductType.Clustered]: { sql: V1_HTTP, influxql: V1_HTTP },
};

/**
 * Formats the read-only tools return. Parquet is binary and pretty is a
 * drawn table; neither can be bounded and counted inside a JSON envelope.
 */
export const READ_ONLY_FORMATS: readonly QueryFormat[] = [
  "json",
  "jsonl",
  "csv",
];

/**
 * Refuse a format or option the route does not support. `allowedFormats`
 * narrows the route's formats further, as the read-only tools do.
 */
export function assertQuerySupported(
  product: string | undefined,
  route: QueryLanguage,
  options: { format?: QueryFormat; timeoutMs?: number },
  allowedFormats: readonly QueryFormat[] = ALL_FORMATS,
): void {
  // An unknown product is refused by dispatch itself.
  const capabilities = CAPABILITIES[product as InfluxProductType];
  if (!capabilities) return;
  const { formats, timeout } = capabilities[route];
  const format = options.format ?? "json";
  const supported = formats.filter((candidate) =>
    allowedFormats.includes(candidate),
  );
  const routeName = route === "sql" ? "SQL" : "InfluxQL";

  if (!supported.includes(format)) {
    const error = new Error(
      `Query format '${format}' is not supported by this MCP ${routeName} query path for ${product}; use ${supported.map((candidate) => `'${candidate}'`).join(", ")}`,
    );
    (error as any).code = "unsupported_query_format";
    (error as any).supported_formats = supported;
    throw error;
  }

  if (options.timeoutMs !== undefined && !timeout) {
    throw unsupportedOption(
      `timeoutMs is not supported for ${routeName} queries on ${product}, which use Flight; configure the client query timeout instead`,
    );
  }
}

export function unsupportedOption(message: string): Error {
  const error = new Error(message);
  (error as any).code = "unsupported_query_option";
  return error;
}
