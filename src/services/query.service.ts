import { BaseConnectionService } from "./base-connection.service.js";
import type { HttpClientService } from "./http-client.service.js";
import type { QParamType } from "@influxdata/influxdb3-client";
import { z } from "zod";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { QueryLanguage, QuerySafetyService } from "./query-safety.service.js";
import {
  OperationError,
  resolveOperationError,
} from "./error-resolution.service.js";
import { createRequestId } from "./telemetry.service.js";
import { queryV1, v1SeriesRows } from "./v1-query.js";
import {
  decodePayload,
  returnedQueryFormat,
  type DecodedPayload,
  type QueryFormat,
} from "./query-payload.js";
import {
  assertQuerySupported,
  ROW_COUNTABLE_READ_ONLY_FORMATS,
  unsupportedOption,
} from "./query-capabilities.js";

const BUCKET_WITHOUT_DBRP_MAPPING = /database not found/iu;

export interface QueryResult {
  results?: any[];
  data?: any;
}

export interface MeasurementInfo {
  name: string;
}

export interface SchemaInfo {
  schema_mode?:
    | {
        value: "implicit" | "explicit";
        source: "server";
        catalog: "system.databases";
      }
    | { value: "unknown"; source: "unknown" };
  deletion?:
    | { value: boolean; source: "server"; catalog: "system.tables" }
    | { value: "unknown"; source: "unknown" };
  warnings?: Array<{ code: string; message: string }>;
  columns: Array<{
    name: string;
    type: string;
    category: "time" | "tag" | "field" | "unknown";
    source?: "server" | "inferred" | "unknown";
    categoryConfidence?: "high" | "low";
    nullable?: boolean;
    warnings?: string[];
  }>;
}

export type { QueryFormat };

export interface ReadOnlyQueryOptions {
  format?: QueryFormat;
  maxRows?: number;
  timeoutMs?: number;
  params?: Record<string, unknown> | unknown[];
}

export interface StructuredQueryResponse {
  ok: true;
  access_outcome: "data" | "empty";
  db: string;
  q: string;
  format: QueryFormat;
  rows: unknown[];
  metadata: QueryMetadata & { success: true } & SuccessfulQueryCompletion;
  warnings: Array<{ code: string; message: string }>;
}

interface QueryMetadata {
  request_id: string;
  query_id: string;
  query_id_source: "local" | "system.queries.id";
  phase?: string;
  query_type: QueryLanguage;
  running?: boolean;
  cancelled?: boolean;
  plan_duration?: unknown;
  permit_duration?: unknown;
  execute_duration?: unknown;
  end2end_duration?: unknown;
  compute_duration?: unknown;
  max_memory?: number;
  duration_ms: number;
  row_count: number;
}

type QueryCompletion =
  | {
      completeness: "complete";
      truncated: false;
      cap?: never;
      cap_source?: never;
    }
  | {
      completeness: "capped";
      truncated: true;
      cap: number;
      cap_source: "server_bound" | "query_limit";
    }
  | {
      completeness: "interrupted";
      truncated: true;
      cap?: never;
      cap_source?: never;
    };

export type Completeness = QueryCompletion["completeness"];
type SuccessfulQueryCompletion = Exclude<
  QueryCompletion,
  { completeness: "interrupted" }
>;

class InterruptedQueryError extends Error {
  readonly code = "query_interrupted";
  metadata?: QueryMetadata & { success: false } & Extract<
      QueryCompletion,
      { completeness: "interrupted" }
    >;

  constructor(
    public rows: unknown[],
    reason: string,
  ) {
    super(`Query interrupted after ${rows.length} rows: ${reason}`);
  }
}

interface QueryHistoryMetadata {
  id: string;
  phase?: string;
  query_type?: QueryLanguage;
  success?: boolean;
  running?: boolean;
  cancelled?: boolean;
  plan_duration?: unknown;
  permit_duration?: unknown;
  execute_duration?: unknown;
  end2end_duration?: unknown;
  compute_duration?: unknown;
  max_memory?: number;
}

interface RecoveryHint {
  kind: "quoted_wildcard_or_unknown_field";
  unknown_field: string;
  recommended_next_tool: "describe_table";
  recommended_strategy: string;
  candidate_prefix?: string;
}

export class QueryService {
  private baseService: BaseConnectionService;
  private safetyService = new QuerySafetyService();

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  async executeQuery(
    query: string,
    database: string,
    options: {
      format?: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    } = {},
  ): Promise<any> {
    this.baseService.validateDataCapabilities();

    const format = options.format ?? "json";
    const connectionInfo = this.baseService.getConnectionInfo();
    assertQuerySupported(connectionInfo.type, "sql", options);
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.executeCloudDedicatedQuery(query, database, options);
      case InfluxProductType.Clustered:
        return this.executeV1Query(query, database, options);
      case InfluxProductType.CloudServerless:
        return this.executeCloudServerlessQuery(query, database, options);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.executeCoreEnterpriseQuery(query, database, {
          format,
          params: options.params,
          timeoutMs: options.timeoutMs,
        });
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  async querySqlReadOnly(
    query: string,
    database: string,
    options: ReadOnlyQueryOptions = {},
  ): Promise<StructuredQueryResponse> {
    return this.queryReadOnly("sql", query, database, options);
  }

  async queryInfluxqlReadOnly(
    query: string,
    database: string,
    options: ReadOnlyQueryOptions = {},
  ): Promise<StructuredQueryResponse> {
    return this.queryReadOnly("influxql", query, database, options);
  }

  private async queryReadOnly(
    language: QueryLanguage,
    query: string,
    database: string,
    options: ReadOnlyQueryOptions,
  ): Promise<StructuredQueryResponse> {
    const requestId = createRequestId();
    const queryId = createRequestId();
    const started = Date.now();
    const maxRows = Math.min(options.maxRows ?? 1000, 5000);
    const format = options.format ?? "json";
    const safety = this.safetyService.validate(query, language, maxRows);

    if (!safety.ok || !safety.normalizedQuery || !safety.executedQuery) {
      const duration = Date.now() - started;
      const error = new Error(safety.message || "Query rejected");
      (error as any).code = safety.code;
      (error as any).fix = safety.fix;
      (error as any).metadata = {
        request_id: requestId,
        query_id: queryId,
        query_id_source: "local",
        query_type: language,
        success: false,
        duration_ms: duration,
        row_count: 0,
        truncated: false,
      };
      throw error;
    }

    try {
      assertQuerySupported(
        this.baseService.getConnectionInfo().type,
        language,
        { format, timeoutMs: options.timeoutMs },
        ROW_COUNTABLE_READ_ONLY_FORMATS,
      );
      const payload = await this.executeReadOnlyQuery(
        language,
        safety.executedQuery,
        database,
        {
          format,
          params: options.params,
          timeoutMs: options.timeoutMs,
        },
      );
      const serverCapped = payload.records.length > maxRows;
      const kept = serverCapped
        ? payload.records.slice(0, maxRows)
        : payload.records;
      const callerLimit = safety.queryLimit;
      const callerLimitFilledMoreRowsMayExist =
        !serverCapped &&
        callerLimit !== undefined &&
        kept.length >= callerLimit;
      const completion: SuccessfulQueryCompletion = serverCapped
        ? {
            completeness: "capped",
            truncated: true,
            cap: maxRows,
            cap_source: "server_bound",
          }
        : callerLimitFilledMoreRowsMayExist
          ? {
              completeness: "capped",
              truncated: true,
              cap: callerLimit,
              cap_source: "query_limit",
            }
          : { completeness: "complete", truncated: false };
      const warnings = [...safety.warnings];
      if (callerLimitFilledMoreRowsMayExist) {
        warnings.push({
          code: "limit_reached",
          message: `Returned ${kept.length} rows, the query's own LIMIT ${safety.queryLimit}; more rows may exist.`,
        });
      }
      if (payload.format !== format) {
        warnings.push({
          code: "format_mismatch",
          message: `Requested ${format} but the server returned ${payload.format}.`,
        });
      }
      const duration = Date.now() - started;
      const history = await this.findQueryHistoryMetadata(
        safety.executedQuery,
        language,
      );

      return {
        ok: true,
        access_outcome: kept.length ? "data" : "empty",
        db: database,
        q: safety.normalizedQuery,
        format: payload.format,
        rows: payload.renderRows(kept),
        metadata: {
          request_id: requestId,
          query_id: history?.id || queryId,
          query_id_source: history ? "system.queries.id" : "local",
          phase: history?.phase,
          query_type: language,
          success: true,
          duration_ms: duration,
          row_count: kept.length,
          ...completion,
          ...(history?.running !== undefined && { running: history.running }),
          ...(history?.cancelled !== undefined && {
            cancelled: history.cancelled,
          }),
          ...(history?.plan_duration !== undefined && {
            plan_duration: history.plan_duration,
          }),
          ...(history?.permit_duration !== undefined && {
            permit_duration: history.permit_duration,
          }),
          ...(history?.execute_duration !== undefined && {
            execute_duration: history.execute_duration,
          }),
          ...(history?.end2end_duration !== undefined && {
            end2end_duration: history.end2end_duration,
          }),
          ...(history?.compute_duration !== undefined && {
            compute_duration: history.compute_duration,
          }),
          ...(history?.max_memory !== undefined && {
            max_memory: history.max_memory,
          }),
        },
        warnings,
      };
    } catch (error: any) {
      const duration = Date.now() - started;
      if (error instanceof InterruptedQueryError) {
        error.rows = error.rows.slice(0, maxRows);
        error.metadata = {
          request_id: requestId,
          query_id: queryId,
          query_id_source: "local",
          query_type: language,
          success: false,
          duration_ms: duration,
          row_count: error.rows.length,
          truncated: true,
          completeness: "interrupted",
        };
      }
      if (!error.metadata) {
        error.metadata = {
          request_id: requestId,
          query_id: queryId,
          query_id_source: "local",
          query_type: language,
          success: false,
          duration_ms: duration,
          row_count: 0,
          truncated: false,
        };
      }
      const recoveryHint = this.buildRecoveryHint(
        language,
        safety.normalizedQuery,
      );
      if (recoveryHint) {
        error.metadata = {
          ...error.metadata,
          recovery_hint: recoveryHint,
        };
      }
      throw error;
    }
  }

  private buildRecoveryHint(
    language: QueryLanguage,
    query: string,
  ): RecoveryHint | undefined {
    if (language !== "sql") return undefined;

    const quotedWildcard = query.match(/"([^"]*\*[^"]*)"/u);
    if (!quotedWildcard) return undefined;

    const unknownField = quotedWildcard[1];
    const starIndex = unknownField.indexOf("*");
    const candidatePrefix =
      starIndex > 0 ? unknownField.slice(0, starIndex) : undefined;

    return {
      kind: "quoted_wildcard_or_unknown_field",
      unknown_field: unknownField,
      recommended_next_tool: "describe_table",
      recommended_strategy:
        "Call describe_table for the target table, expand matching fields explicitly, then run one bounded query_sql. Use query_influxql regex only when the user explicitly asks for InfluxQL or regex field selection.",
      ...(candidatePrefix && { candidate_prefix: candidatePrefix }),
    };
  }

  private async executeReadOnlyQuery(
    language: QueryLanguage,
    query: string,
    database: string,
    options: {
      format: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<DecodedPayload> {
    this.baseService.validateDataCapabilities();
    const product = this.baseService.getConnectionInfo().type;
    if (
      product === InfluxProductType.Core ||
      product === InfluxProductType.Enterprise
    ) {
      const response = await this.requestV3Query(
        language === "sql" ? "/api/v3/query_sql" : "/api/v3/query_influxql",
        query,
        database,
        options,
      );
      return decodePayload(response.data, response.format);
    }
    if (language === "sql") {
      const raw = await this.executeQuery(query, database, {
        format: options.format,
        params: options.params,
        timeoutMs: options.timeoutMs,
      });
      return decodePayload(raw, options.format);
    }

    const rows = await this.executeInfluxqlQuery(query, database, options);
    return decodePayload(rows, options.format);
  }

  private async findQueryHistoryMetadata(
    query: string,
    language: QueryLanguage,
  ): Promise<QueryHistoryMetadata | undefined> {
    const connectionInfo = this.baseService.getConnectionInfo();
    if (
      connectionInfo.type !== InfluxProductType.Core &&
      connectionInfo.type !== InfluxProductType.Enterprise
    ) {
      return undefined;
    }

    try {
      const escapedQuery = query.replace(/'/gu, "''");
      const historyQuery = `
        SELECT
          id,
          phase,
          query_type,
          success,
          running,
          cancelled,
          plan_duration,
          permit_duration,
          execute_duration,
          end2end_duration,
          compute_duration,
          max_memory
        FROM system.queries
        WHERE query_text = '${escapedQuery}'
          AND query_type = '${language}'
        ORDER BY issue_time DESC
        LIMIT 1
      `;
      const result = await this.executeCoreEnterpriseQuery(
        historyQuery,
        "_internal",
        {
          format: "json",
        },
      );
      return decodePayload(result, "json").records[0] as
        | QueryHistoryMetadata
        | undefined;
    } catch {
      return undefined;
    }
  }

  async executeInfluxqlQuery(
    query: string,
    database: string,
    options: {
      format?: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    } = {},
  ): Promise<any> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    assertQuerySupported(connectionInfo.type, "influxql", options);
    switch (connectionInfo.type) {
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.executeCoreEnterpriseInfluxqlQuery(
          query,
          database,
          options,
        );
      case InfluxProductType.CloudServerless:
        return v1SeriesRows(
          await this.executeCloudServerlessInfluxqlQuery(
            query,
            database,
            options,
          ),
        );
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return v1SeriesRows(
          await this.executeV1Query(query, database, options),
        );
      default:
        throw new Error(
          `InfluxQL queries are not supported for ${connectionInfo.type}`,
        );
    }
  }

  private async executeCoreEnterpriseQuery(
    query: string,
    database: string,
    options: {
      format: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    return (
      await this.requestV3Query("/api/v3/query_sql", query, database, options)
    ).data;
  }

  private async executeCoreEnterpriseInfluxqlQuery(
    query: string,
    database: string,
    options: {
      format?: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    return (
      await this.requestV3Query("/api/v3/query_influxql", query, database, {
        ...options,
        format: options.format ?? "json",
      })
    ).data;
  }

  private async requestV3Query(
    path: "/api/v3/query_sql" | "/api/v3/query_influxql",
    query: string,
    database: string,
    options: {
      format: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<{ data: unknown; format: QueryFormat }> {
    const requestedFormat = options.format;
    let response: Awaited<ReturnType<HttpClientService["postText"]>>;
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const payload = {
        db: database,
        q: query,
        format: requestedFormat,
        ...(options.params !== undefined && { params: options.params }),
      };
      response = await httpClient.postText(path, payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: this.acceptHeader(requestedFormat),
        },
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
      });
    } catch (error: any) {
      throw resolveOperationError(error);
    }

    const format = returnedQueryFormat(response.contentType, requestedFormat);
    if (format !== "json") {
      if (response.interruption) {
        throw new InterruptedQueryError([], response.interruption.message);
      }
      return { data: response.text, format };
    }

    const finishedJsonBody = response.interruption
      ? undefined
      : parseFinishedJsonBody(response.text);
    if (finishedJsonBody) return { data: finishedJsonBody.value, format };
    throw new InterruptedQueryError(
      wholeElementsOfUnfinishedJsonArray(response.text),
      response.interruption?.message ?? UNFINISHED_RESPONSE_REASON,
    );
  }

  private acceptHeader(format: string): string {
    switch (format) {
      case "csv":
        return "text/csv";
      case "parquet":
        return "application/vnd.apache.parquet";
      default:
        return "application/json";
    }
  }

  private async executeCloudDedicatedQuery(
    query: string,
    database: string,
    options: {
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    const params = this.flightParams(options);

    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const result = client.queryPoints(query, database, {
        type: "sql",
        ...(params !== undefined && { params }),
      });
      const rows: any[] = [];
      for await (const row of result) {
        rows.push(row);
      }
      return rows;
    } catch (error: any) {
      throw resolveOperationError(error);
    }
  }

  private async executeV1Query(
    query: string,
    database: string,
    options: {
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    } = {},
  ): Promise<any> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await queryV1(httpClient, {
        params: {
          db: database,
          q: query,
          ...(options.params !== undefined && { params: options.params }),
        },
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
      });
      return response;
    } catch (error: any) {
      throw resolveOperationError(error);
    }
  }

  private async executeCloudServerlessInfluxqlQuery(
    query: string,
    database: string,
    options: {
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    try {
      return await this.executeV1Query(query, database, options);
    } catch (error) {
      if (
        error instanceof OperationError &&
        BUCKET_WITHOUT_DBRP_MAPPING.test(error.message)
      ) {
        throw new OperationError(
          `${error.message}. Either bucket '${database}' doesn't exist, or it has no DBRP mapping: Cloud Serverless answers InfluxQL through the v1 /query endpoint, which needs one. Check the name with list_databases. Writes through /api/v2/write, which write_line_protocol uses, don't create one. Read the same data with query_sql, which needs no mapping. Or create a default DBRP mapping for the bucket with POST /api/v2/dbrps: database '${database}', a retention_policy such as 'autogen' (required), and default: true.`,
          "influxql_bucket_not_mapped",
          "none",
          error.status,
        );
      }
      throw error;
    }
  }

  /**
   * Query for cloud-serverless (influxdb3 client)
   */
  private async executeCloudServerlessQuery(
    query: string,
    database: string,
    options: {
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    const params = this.flightParams(options);

    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const result = client.queryPoints(query, database, {
        type: "sql",
        ...(params !== undefined && { params }),
      });
      const rows: any[] = [];
      for await (const row of result) {
        rows.push(row);
      }
      return rows;
    } catch (error: any) {
      throw resolveOperationError(error);
    }
  }

  private flightParams(options: {
    params?: Record<string, unknown> | unknown[];
  }): Record<string, QParamType> | undefined {
    if (Array.isArray(options.params)) {
      throw unsupportedOption(
        "Array query params are not supported for Flight queries; use a named parameter object instead",
      );
    }

    if (
      options.params !== undefined &&
      Object.values(options.params).some(
        (value) =>
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean",
      )
    ) {
      throw unsupportedOption(
        "Flight query params must be strings, numbers, or booleans",
      );
    }

    return options.params as Record<string, QParamType> | undefined;
  }

  async getMeasurements(database: string): Promise<MeasurementInfo[]> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.getMeasurementsOverV1(database);
      case InfluxProductType.CloudServerless:
        return this.getMeasurementsCloudServerless(database);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.getMeasurementsCoreEnterprise(database);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  private async getMeasurementsOverV1(
    database: string,
  ): Promise<MeasurementInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await queryV1(httpClient, {
        params: {
          db: database,
          q: "SHOW MEASUREMENTS",
        },
      });

      if (
        response.results &&
        response.results[0] &&
        response.results[0].series
      ) {
        const series = response.results[0].series[0];
        if (series.name === "measurements" && series.values) {
          return series.values.map((value: any[]) => ({ name: value[0] }));
        }
      }

      return [];
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  private async getMeasurementsCoreEnterprise(
    database: string,
  ): Promise<MeasurementInfo[]> {
    try {
      const query =
        "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'iox'";
      const result = await this.executeQuery(query, database, {
        format: "json",
      });

      if (Array.isArray(result)) {
        return result.map((row: any) => ({ name: row.table_name }));
      }
      return result;
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  private async getMeasurementsCloudServerless(
    database: string,
  ): Promise<MeasurementInfo[]> {
    try {
      const query =
        "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'iox'";
      const result = await this.executeQuery(query, database, {
        format: "json",
      });

      if (Array.isArray(result)) {
        return result
          .map((row: any) => ({
            name: serverlessFieldValue(row, "table_name"),
          }))
          .filter((item: any) => item.name);
      }
      return [];
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  async getMeasurementSchema(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.getMeasurementSchemaOverV1(measurement, database);
      case InfluxProductType.CloudServerless:
        return this.getMeasurementSchemaCloudServerless(measurement, database);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.getMeasurementSchemaCoreEnterprise(measurement, database);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  private async getMeasurementSchemaOverV1(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();

      const fieldKeysResponse = await queryV1(httpClient, {
        params: {
          db: database,
          q: `SHOW FIELD KEYS FROM "${measurement.replace(/"/gu, '""')}"`,
        },
      });

      const tagKeysResponse = await queryV1(httpClient, {
        params: {
          db: database,
          q: `SHOW TAG KEYS FROM "${measurement.replace(/"/gu, '""')}"`,
        },
      });
      const columns: {
        name: string;
        type: string;
        category: "time" | "tag" | "field" | "unknown";
        categoryConfidence: "high" | "low";
      }[] = [];

      if (
        fieldKeysResponse.results &&
        fieldKeysResponse.results[0] &&
        fieldKeysResponse.results[0].series
      ) {
        const fieldSeries = fieldKeysResponse.results[0].series[0];
        if (fieldSeries && fieldSeries.values) {
          fieldSeries.values.forEach((value: any[]) => {
            columns.push({
              name: value[0],
              type: value[1],
              category: "field",
              categoryConfidence: "high",
            });
          });
        }
      }

      if (
        tagKeysResponse.results &&
        tagKeysResponse.results[0] &&
        tagKeysResponse.results[0].series
      ) {
        const tagSeries = tagKeysResponse.results[0].series[0];
        if (tagSeries && tagSeries.values) {
          tagSeries.values.forEach((value: any[]) => {
            columns.push({
              name: value[0],
              type: "string",
              category: "tag",
              categoryConfidence: "high",
            });
          });
        }
      }

      columns.unshift({
        name: "time",
        type: "timestamp",
        category: "time",
        categoryConfidence: "high",
      });

      return { columns };
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  private async getMeasurementSchemaCoreEnterprise(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    try {
      const query = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${measurement.replace(/'/gu, "''")}' AND table_schema = 'iox'`;
      const result = await this.executeQuery(query, database, {
        format: "json",
      });

      if (Array.isArray(result)) {
        const columnRows = z
          .array(z.object({ column_name: z.string(), data_type: z.string() }))
          .safeParse(result);
        if (!columnRows.success)
          throw new Error("Column metadata has an unexpected shape");
        const tableHasColumns = result.length > 0;
        const roles = tableHasColumns
          ? await this.readServerColumnRolesWhenAvailable(measurement, database)
          : new Map<string, string>();
        const metadata = tableHasColumns
          ? await this.readCatalogMetadataWithCallerCredential(
              measurement,
              database,
            )
          : { warnings: [] };
        const fieldTypes = new Set([
          "float",
          "integer",
          "uinteger",
          "boolean",
          "string",
        ]);
        const columns = columnRows.data.map(
          (row): SchemaInfo["columns"][number] => {
            let category: "time" | "tag" | "field" | "unknown" = "unknown";
            let categoryConfidence: "high" | "low" = "low";
            let source: "server" | "inferred" | "unknown" = "unknown";
            const role = roles.get(row.column_name);

            if (
              role === "tag" ||
              role === "time" ||
              (role && fieldTypes.has(role))
            ) {
              category =
                role === "tag" ? "tag" : role === "time" ? "time" : "field";
              categoryConfidence = "high";
              source = "server";
            } else if (row.column_name === "time") {
              category = "time";
              categoryConfidence = "high";
              source = "inferred";
            }

            return {
              name: row.column_name,
              type: row.data_type,
              category,
              source,
              categoryConfidence,
              warnings:
                category === "unknown"
                  ? ["Tag versus field role is not available from metadata."]
                  : undefined,
            };
          },
        );
        return { columns, ...metadata };
      }
      return result;
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  private async readServerColumnRolesWhenAvailable(
    measurement: string,
    database: string,
  ): Promise<Map<string, string>> {
    const roles = new Map<string, string>();
    try {
      const response = await this.executeQuery(
        "SELECT key, data_type FROM system.influxdb_schema WHERE measurement = $table",
        database,
        { format: "json", params: { table: measurement } },
      );
      const parsed = z
        .array(z.object({ key: z.string(), data_type: z.string() }))
        .safeParse(response);
      if (parsed.success) {
        for (const row of parsed.data) roles.set(row.key, row.data_type);
      }
    } catch {
      return roles;
    }
    return roles;
  }

  private async readCatalogMetadataWithCallerCredential(
    measurement: string,
    database: string,
  ): Promise<Pick<SchemaInfo, "schema_mode" | "deletion" | "warnings">> {
    const catalogRow = await this.readCatalogRowWithCallerCredential(
      measurement,
      database,
    );
    if (!catalogRow) {
      return {
        warnings: [
          {
            code: "catalog_metadata_unavailable",
            message:
              "Schema mode and deletion status are unknown because the internal catalog is unavailable to this credential.",
          },
        ],
      };
    }
    return {
      warnings: [],
      schema_mode: {
        value: catalogRow.schema_mode,
        source: "server",
        catalog: "system.databases",
      },
      deletion: {
        value: catalogRow.deleted,
        source: "server",
        catalog: "system.tables",
      },
    };
  }

  private async readCatalogRowWithCallerCredential(
    measurement: string,
    database: string,
  ): Promise<
    { deleted: boolean; schema_mode: "implicit" | "explicit" } | undefined
  > {
    try {
      const response = await this.executeQuery(
        "SELECT t.deleted, d.schema_mode FROM system.tables t JOIN system.databases d ON t.database_name = d.database_name WHERE t.database_name = $db AND t.table_name = $table",
        "_internal",
        { format: "json", params: { db: database, table: measurement } },
      );
      const parsed = z
        .array(
          z.object({
            deleted: z.boolean(),
            schema_mode: z.enum(["implicit", "explicit"]),
          }),
        )
        .length(1)
        .safeParse(response);
      return parsed.success ? parsed.data[0] : undefined;
    } catch {
      return undefined;
    }
  }

  private async getMeasurementSchemaCloudServerless(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    try {
      const query = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${measurement.replace(/'/gu, "''")}' AND table_schema = 'iox'`;
      const result = await this.executeQuery(query, database, {
        format: "json",
      });

      if (Array.isArray(result)) {
        const columns = result
          .map((row: any): SchemaInfo["columns"][number] => {
            const columnName = serverlessFieldValue(row, "column_name");
            const dataType = serverlessFieldValue(row, "data_type");

            let category: "time" | "tag" | "field" | "unknown" = "unknown";
            let categoryConfidence: "high" | "low" = "low";

            if (columnName === "time") {
              category = "time";
              categoryConfidence = "high";
            } else if (dataType?.includes("Dictionary")) {
              category = "tag";
              categoryConfidence = "high";
            }

            return {
              name: columnName,
              type: dataType,
              category,
              source: category === "unknown" ? "unknown" : "inferred",
              categoryConfidence,
              warnings:
                category === "unknown"
                  ? ["Tag versus field role is not available from metadata."]
                  : undefined,
            };
          })
          .filter((col: any) => col.name);
        return { columns };
      }
      return { columns: [] };
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }
}

const UNFINISHED_RESPONSE_REASON =
  "the response ended before the result was complete";

function parseFinishedJsonBody(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function serverlessFieldValue(row: any, fieldName: string): any {
  return row._fields?.[fieldName]?.[1];
}

function wholeElementsOfUnfinishedJsonArray(text: string): any[] {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastElementEnd = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 1) lastElementEnd = index;
    }
  }

  if (lastElementEnd === -1) return [];
  try {
    return JSON.parse(`${text.slice(0, lastElementEnd + 1)}]`);
  } catch {
    return [];
  }
}
