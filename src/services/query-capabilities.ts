import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import type { QueryFormat } from "./query-payload.js";
import type { QueryLanguage } from "./query-safety.service.js";

interface RouteCapabilities {
  formats: readonly QueryFormat[];
  forwardsPerQueryTimeout: boolean;
}

const ALL_FORMATS: readonly QueryFormat[] = [
  "json",
  "jsonl",
  "csv",
  "pretty",
  "parquet",
];

const V3_HTTP_QUERY_API: RouteCapabilities = {
  formats: ALL_FORMATS,
  forwardsPerQueryTimeout: true,
};
const FLIGHT_SQL_CLIENT: RouteCapabilities = {
  formats: ["json"],
  forwardsPerQueryTimeout: false,
};
const V1_COMPATIBLE_QUERY_API: RouteCapabilities = {
  formats: ["json"],
  forwardsPerQueryTimeout: true,
};

const ROUTE_CAPABILITIES_BY_PRODUCT: Record<
  InfluxProductType,
  Record<QueryLanguage, RouteCapabilities>
> = {
  [InfluxProductType.Core]: {
    sql: V3_HTTP_QUERY_API,
    influxql: V3_HTTP_QUERY_API,
  },
  [InfluxProductType.Enterprise]: {
    sql: V3_HTTP_QUERY_API,
    influxql: V3_HTTP_QUERY_API,
  },
  [InfluxProductType.CloudDedicated]: {
    sql: FLIGHT_SQL_CLIENT,
    influxql: V1_COMPATIBLE_QUERY_API,
  },
  [InfluxProductType.CloudServerless]: {
    sql: FLIGHT_SQL_CLIENT,
    influxql: V1_COMPATIBLE_QUERY_API,
  },
  [InfluxProductType.Clustered]: {
    sql: V1_COMPATIBLE_QUERY_API,
    influxql: V1_COMPATIBLE_QUERY_API,
  },
};

export const ROW_COUNTABLE_READ_ONLY_FORMATS: readonly QueryFormat[] = [
  "json",
  "jsonl",
  "csv",
];

export function assertQuerySupported(
  product: string | undefined,
  route: QueryLanguage,
  options: { format?: QueryFormat; timeoutMs?: number },
  callerAllowedFormats: readonly QueryFormat[] = ALL_FORMATS,
): void {
  const productCapabilities =
    ROUTE_CAPABILITIES_BY_PRODUCT[product as InfluxProductType];
  const unknownProductIsRefusedByDispatch = !productCapabilities;
  if (unknownProductIsRefusedByDispatch) return;
  const { formats, forwardsPerQueryTimeout } = productCapabilities[route];
  const format = options.format ?? "json";
  const supported = formats.filter((candidate) =>
    callerAllowedFormats.includes(candidate),
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

  if (options.timeoutMs !== undefined && !forwardsPerQueryTimeout) {
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
