/**
 * InfluxDB Query Service
 *
 * Handles query operations using InfluxDB v3 SQL API
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { QueryLanguage, QuerySafetyService } from "./query-safety.service.js";
import { createRequestId } from "./telemetry.service.js";

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
    categoryConfidence?: "high" | "low";
    nullable?: boolean;
    warnings?: string[];
  }>;
}

export type QueryFormat = "json" | "csv" | "parquet" | "jsonl" | "pretty";

export interface ReadOnlyQueryOptions {
  format?: QueryFormat;
  maxRows?: number;
  timeoutMs?: number;
  params?: Record<string, unknown> | unknown[];
}

export interface StructuredQueryResponse {
  ok: true;
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
    truncated: boolean;
  };
  warnings: Array<{ code: string; message: string }>;
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
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.executeCloudDedicatedQuery(query, database);
      case InfluxProductType.Clustered:
        return this.executeClusteredQuery(query, database);
      case InfluxProductType.CloudServerless:
        return this.executeCloudServerlessQuery(query, database);
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

    if (!safety.ok || !safety.normalizedQuery) {
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
      const raw = await this.executeReadOnlyQuery(
        language,
        safety.normalizedQuery,
        database,
        {
          format,
          params: options.params,
          timeoutMs: options.timeoutMs,
        },
      );
      const rows = this.normalizeRows(raw, format);
      const truncated = rows.length > maxRows;
      const outputRows = truncated ? rows.slice(0, maxRows) : rows;
      const duration = Date.now() - started;
      const history = await this.findQueryHistoryMetadata(
        safety.normalizedQuery,
        language,
      );

      return {
        ok: true,
        db: database,
        q: safety.normalizedQuery,
        format,
        rows: outputRows,
        metadata: {
          request_id: requestId,
          query_id: history?.id || queryId,
          query_id_source: history ? "system.queries.id" : "local",
          phase: history?.phase,
          query_type: language,
          success: history?.success ?? true,
          duration_ms: duration,
          row_count: outputRows.length,
          truncated,
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
        warnings: safety.warnings,
      };
    } catch (error: any) {
      const duration = Date.now() - started;
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
      throw error;
    }
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
      const rows = this.normalizeRows(result, "json");
      return rows[0];
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
    switch (connectionInfo.type) {
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.executeCoreEnterpriseInfluxqlQuery(
          query,
          database,
          options,
        );
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.executeClusteredQuery(query, database);
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
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const format = options.format;
      const payload = {
        db: database,
        q: query,
        format,
        ...(options.params !== undefined && { params: options.params }),
      };
      const response = await httpClient.post("/api/v3/query_sql", payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: this.acceptHeader(format),
        },
        ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
      });
      return response;
    } catch (error: any) {
      this.handleQueryError(error);
    }
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
    try {
      const format = options.format ?? "json";
      const httpClient = this.baseService.getInfluxHttpClient();
      const payload = {
        db: database,
        q: query,
        format,
        ...(options.params !== undefined && { params: options.params }),
      };
      const response = await httpClient.post(
        "/api/v3/query_influxql",
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: this.acceptHeader(format),
          },
          ...(options.timeoutMs !== undefined && {
            timeout: options.timeoutMs,
          }),
        },
      );
      return response;
    } catch (error: any) {
      this.handleQueryError(error);
    }
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

  private normalizeRows(raw: any, format: QueryFormat): any[] {
    if (format !== "json" && format !== "pretty") {
      return Array.isArray(raw) ? raw : [{ value: raw }];
    }

    if (Array.isArray(raw)) {
      return raw;
    }

    if (Array.isArray(raw?.rows)) {
      return raw.rows;
    }

    if (Array.isArray(raw?.data)) {
      return raw.data;
    }

    if (raw && typeof raw === "object") {
      return [raw];
    }

    return [];
  }

  /**
   * Query for cloud-dedicated/clustered (influxdb3 client)
   */
  private async executeCloudDedicatedQuery(
    query: string,
    database: string,
  ): Promise<any> {
    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const result = client.queryPoints(query, database, { type: "sql" });
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
  ): Promise<any> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await httpClient.get("/query", {
        params: {
          db: database,
          q: query,
        },
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
  ): Promise<any> {
    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const result = client.queryPoints(query, database, { type: "sql" });
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
   * Centralized error handler for query methods
   */
  private handleQueryError(error: any): never {
    const errorMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      (typeof error.response?.data === "string" ? error.response.data : null) ||
      error.response?.statusText ||
      error.message;
    const statusCode = error.response?.status;
    console.error(`Status: ${statusCode} \n Message: ${errorMessage}`);
    switch (statusCode) {
      case 400:
        throw new Error(`Bad request: ${errorMessage}`);
      case 401:
        throw new Error(`Unauthorized: ${errorMessage}`);
      case 403:
        throw new Error(`Access denied: ${errorMessage}`);
      case 404:
        throw new Error(`Database not found: ${errorMessage}`);
      case 405:
        throw new Error(`Method not allowed: ${errorMessage}`);
      case 422:
        throw new Error(`Unprocessable entity: ${errorMessage}`);
      default:
        throw new Error(`Query failed: ${errorMessage}`);
    }
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
      throw new Error(`Failed to get measurements: ${error.message}`);
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
      throw new Error(`Failed to get measurements: ${error.message}`);
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
      throw new Error(`Failed to get measurements: ${error.message}`);
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
      throw new Error(`Failed to get measurements: ${error.message}`);
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
          q: `SHOW FIELD KEYS FROM ${measurement}`,
        },
      });

      const tagKeysResponse = await httpClient.get("/query", {
        params: {
          db: database,
          q: `SHOW TAG KEYS FROM ${measurement}`,
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
      if (
        error.response?.status === 404 ||
        error.message.includes("not found")
      ) {
        throw new Error(
          `Measurement '${measurement}' does not exist in database '${database}'`,
        );
      }
      throw new Error(
        `Failed to get schema for measurement '${measurement}': ${error.message}`,
      );
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
          q: `SHOW FIELD KEYS FROM ${measurement}`,
        },
      });

      const tagKeysResponse = await httpClient.get("/query", {
        params: {
          db: database,
          q: `SHOW TAG KEYS FROM ${measurement}`,
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
      if (
        error.response?.status === 404 ||
        error.message.includes("not found")
      ) {
        throw new Error(
          `Measurement '${measurement}' does not exist in database '${database}'`,
        );
      }
      throw new Error(
        `Failed to get schema for measurement '${measurement}': ${error.message}`,
      );
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
      const query = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${measurement}' AND table_schema = 'iox'`;
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
      if (error.message.includes("not found")) {
        throw new Error(
          `Table '${measurement}' does not exist in database '${database}'`,
        );
      }
      throw new Error(
        `Failed to get schema for measurement '${measurement}': ${error.message}`,
      );
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
      const query = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${measurement}' AND table_schema = 'iox'`;
      const result = await this.executeQuery(query, database, {
        format: "json",
      });

      if (Array.isArray(result)) {
        const columns = result
          .map((row: any) => {
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
      if (error.message.includes("not found")) {
        throw new Error(
          `Table '${measurement}' does not exist in database '${database}'`,
        );
      }
      throw new Error(
        `Failed to get schema for measurement '${measurement}': ${error.message}`,
      );
    }
  }
}
