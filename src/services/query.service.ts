/**
 * InfluxDB Query Service
 *
 * Handles query operations using InfluxDB v3 SQL API
 */

import { BaseConnectionService } from "./base-connection.service.js";
import type { HttpClientService } from "./http-client.service.js";
import type { QParamType } from "@influxdata/influxdb3-client";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { QueryLanguage, QuerySafetyService } from "./query-safety.service.js";
import { resolveOperationError } from "./error-resolution.service.js";
import { createRequestId } from "./telemetry.service.js";
import { decodePayload, QueryFormat } from "./query-payload.js";
import {
  assertQuerySupported,
  READ_ONLY_FORMATS,
  unsupportedOption,
} from "./query-capabilities.js";

export interface QueryResult {
  results?: any[];
  data?: any;
}

export interface MeasurementInfo {
  name: string;
}

export interface SchemaInfo {
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
  rows: any[];
  metadata: {
    request_id: string;
    query_id: string;
    query_id_source: "local" | "system.queries.id";
    phase?: string;
    query_type: QueryLanguage;
    success: boolean;
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
    /** Kept for compatibility: `completeness !== "complete"`. */
    truncated: boolean;
    completeness: Completeness;
    /** The effective row bound, present when capped. */
    cap?: number;
    cap_source?: "server_bound" | "query_limit";
  };
  warnings: Array<{ code: string; message: string }>;
}

export type Completeness = "complete" | "capped" | "interrupted";

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

  /**
   * Execute SQL query (single entrypoint for all product types)
   * For core/enterprise: HTTP API
   * For cloud-dedicated: influxdb3 client
   * For clustered: HTTP API (/query)
   */
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
        return this.executeClusteredQuery(query, database, options);
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
        READ_ONLY_FORMATS,
      );
      const raw = await this.executeReadOnlyQuery(
        language,
        safety.executedQuery,
        database,
        {
          format,
          params: options.params,
          timeoutMs: options.timeoutMs,
        },
      );
      const payload = decodePayload(raw, format);
      const serverCapped = payload.records.length > maxRows;
      const kept = serverCapped
        ? payload.records.slice(0, maxRows)
        : payload.records;
      // Filling the caller's own LIMIT does not prove more rows exist, so it
      // is reported as capped with a "may" warning rather than asserted.
      const limitReached =
        !serverCapped &&
        safety.queryLimit !== undefined &&
        kept.length >= safety.queryLimit;
      const bound = serverCapped
        ? { cap: maxRows, cap_source: "server_bound" as const }
        : limitReached
          ? { cap: safety.queryLimit, cap_source: "query_limit" as const }
          : undefined;
      const warnings = [...safety.warnings];
      if (limitReached) {
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
        access_outcome: outputRows.length ? "data" : "empty",
        db: database,
        q: safety.normalizedQuery,
        format: payload.format,
        rows: payload.render(kept),
        metadata: {
          request_id: requestId,
          query_id: history?.id || queryId,
          query_id_source: history ? "system.queries.id" : "local",
          phase: history?.phase,
          query_type: language,
          success: history?.success ?? true,
          duration_ms: duration,
          row_count: kept.length,
          truncated: bound !== undefined,
          completeness: bound ? "capped" : "complete",
          ...bound,
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
      if (error.code === "query_interrupted") {
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
  ): Promise<any> {
    if (language === "sql") {
      return this.executeQuery(query, database, {
        format: options.format,
        params: options.params,
        timeoutMs: options.timeoutMs,
      });
    }

    return this.executeInfluxqlQuery(query, database, options);
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
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.CloudServerless:
      case InfluxProductType.Clustered:
        return this.executeClusteredQuery(query, database, options);
      default:
        throw new Error(
          `InfluxQL queries are not supported for ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Query for core/enterprise (HTTP API)
   */
  private async executeCoreEnterpriseQuery(
    query: string,
    database: string,
    options: {
      format: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    return this.postV3Query("/api/v3/query_sql", query, database, options);
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
    return this.postV3Query("/api/v3/query_influxql", query, database, {
      ...options,
      format: options.format ?? "json",
    });
  }

  private async postV3Query(
    path: "/api/v3/query_sql" | "/api/v3/query_influxql",
    query: string,
    database: string,
    options: {
      format: QueryFormat;
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    },
  ): Promise<any> {
    const format = options.format;
    let response: Awaited<ReturnType<HttpClientService["postText"]>>;
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const payload = {
        db: database,
        q: query,
        format,
        ...(options.params !== undefined && { params: options.params }),
      };
      response = await httpClient.postText(path, payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: this.acceptHeader(format),
        },
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
      });
    } catch (error: any) {
      this.handleQueryError(error);
    }

    if (format !== "json") {
      if (response.interruption) {
        throw this.interruptedError([], response.interruption.message);
      }
      return response.text;
    }

    // A JSON body that does not parse, or a stream that failed, means the
    // server began a result it did not finish. An empty result is `[]`, so
    // an empty body is unfinished too. Keep the rows that arrived whole;
    // never report the partial result as a successful one.
    if (!response.interruption) {
      try {
        return JSON.parse(response.text);
      } catch {
        // Fall through to the interrupted result.
      }
    }
    throw this.interruptedError(
      completeArrayElements(response.text),
      response.interruption?.message ??
        "the response ended before the result was complete",
    );
  }

  private interruptedError(rows: any[], reason: string): Error {
    const error = new Error(
      `Query interrupted after ${rows.length} rows: ${reason}`,
    );
    (error as any).code = "query_interrupted";
    (error as any).rows = rows;
    return error;
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

  /**
   * Query for cloud-dedicated/clustered (influxdb3 client)
   */
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
      this.handleQueryError(error);
    }
  }

  /**
   * Query for clustered (HTTP API)
   */
  private async executeClusteredQuery(
    query: string,
    database: string,
    options: {
      params?: Record<string, unknown> | unknown[];
      timeoutMs?: number;
    } = {},
  ): Promise<any> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await httpClient.get("/query", {
        params: {
          db: database,
          q: query,
          ...(options.params !== undefined && { params: options.params }),
        },
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
      });
      return response;
    } catch (error: any) {
      this.handleQueryError(error);
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
      this.handleQueryError(error);
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

  /**
   * Centralized error handler for query methods
   */
  private handleQueryError(error: any): never {
    throw resolveOperationError(error);
  }

  /**
   * Get all measurements/tables in a database
   * Uses SHOW MEASUREMENTS for cloud-dedicated/clustered (HTTP), information_schema for others
   */
  async getMeasurements(database: string): Promise<MeasurementInfo[]> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.getMeasurementsCloudDedicated(database);
      case InfluxProductType.Clustered:
        return this.getMeasurementsClustered(database);
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

  /**
   * Get measurements for cloud-dedicated/clustered (HTTP client with InfluxQL)
   */
  private async getMeasurementsCloudDedicated(
    database: string,
  ): Promise<MeasurementInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await httpClient.get("/query", {
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

  /**
   * Get measurements for clustered (HTTP client with InfluxQL)
   */
  private async getMeasurementsClustered(
    database: string,
  ): Promise<MeasurementInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await httpClient.get("/query", {
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

  /**
   * Get measurements for core/enterprise
   */
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

  /**
   * Get measurements for cloud-serverless
   * Parses the Cloud Serverless response format with _fields arrays
   */
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
          .map((row: any) => {
            // Cloud Serverless format: { "_fields": { "table_name": ["string", "actual_value"] } }
            const tableName = row._fields?.table_name?.[1];
            return { name: tableName };
          })
          .filter((item: any) => item.name); // Filter out undefined names
      }
      return [];
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  /**
   * Get schema information for a measurement/table
   * Uses SHOW FIELD KEYS + SHOW TAG KEYS for cloud-dedicated/clustered (HTTP), information_schema for others
   */
  async getMeasurementSchema(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.getMeasurementSchemaCloudDedicated(measurement, database);
      case InfluxProductType.Clustered:
        return this.getMeasurementSchemaClustered(measurement, database);
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

  /**
   * Get measurement schema for cloud-dedicated/clustered (HTTP client with InfluxQL)
   */
  private async getMeasurementSchemaCloudDedicated(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();

      const fieldKeysResponse = await httpClient.get("/query", {
        params: {
          db: database,
          q: `SHOW FIELD KEYS FROM "${measurement.replace(/"/gu, '""')}"`,
        },
      });

      const tagKeysResponse = await httpClient.get("/query", {
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

  /**
   * Get measurement schema for clustered (HTTP client with InfluxQL)
   */
  private async getMeasurementSchemaClustered(
    measurement: string,
    database: string,
  ): Promise<SchemaInfo> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();

      const fieldKeysResponse = await httpClient.get("/query", {
        params: {
          db: database,
          q: `SHOW FIELD KEYS FROM "${measurement.replace(/"/gu, '""')}"`,
        },
      });

      const tagKeysResponse = await httpClient.get("/query", {
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

  /**
   * Get measurement schema for core/enterprise
   */
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
        const columns = result.map((row: any) => {
          let category: "time" | "tag" | "field" | "unknown" = "unknown";
          let categoryConfidence: "high" | "low" = "low";

          if (row.column_name === "time") {
            category = "time";
            categoryConfidence = "high";
          }

          return {
            name: row.column_name,
            type: row.data_type,
            category,
            categoryConfidence,
            warnings:
              category === "unknown"
                ? ["Tag versus field role is not available from metadata."]
                : undefined,
          };
        });
        return { columns };
      }
      return result;
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  /**
   * Get measurement schema for cloud-serverless
   * Parses the Cloud Serverless response format with _fields arrays
   */
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
            const columnName = row._fields?.column_name?.[1];
            const dataType = row._fields?.data_type?.[1];

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

/**
 * Return the elements of a JSON array that arrived whole, from a body that
 * may stop partway through an element.
 */
function completeArrayElements(text: string): any[] {
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
