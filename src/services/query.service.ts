/**
 * InfluxDB Query Service
 *
 * Handles query operations using InfluxDB v3 SQL API
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

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
    category: "time" | "tag" | "field";
  }>;
}

export class QueryService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  /**
   * Execute SQL query (single entrypoint for all product types)
   * For core/enterprise: HTTP API
   * For cloud-dedicated: influxdb3 client
   */
  async executeQuery(
    query: string,
    database: string,
    options: {
      format?: "json" | "csv" | "parquet" | "jsonl" | "pretty";
    } = {},
  ): Promise<any> {
    this.baseService.validateDataCapabilities();

    const format = options.format ?? "json";
    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.executeCloudDedicatedQuery(query, database);
      case InfluxProductType.CloudServerless:
        return this.executeCloudServerlessQuery(query, database);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.executeCoreEnterpriseQuery(query, database, format);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Query for core/enterprise (HTTP API)
   */
  private async executeCoreEnterpriseQuery(
    query: string,
    database: string,
    format: string,
  ): Promise<any> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const payload = {
        db: database,
        q: query,
        format: format,
      };
      let acceptHeader = "application/json";
      switch (format) {
        case "json":
          acceptHeader = "application/json";
          break;
        case "csv":
          acceptHeader = "text/csv";
          break;
        case "parquet":
          acceptHeader = "application/vnd.apache.parquet";
          break;
        case "jsonl":
          acceptHeader = "application/json";
          break;
        case "pretty":
          acceptHeader = "application/json";
          break;
      }
      const response = await httpClient.post("/api/v3/query_sql", payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: acceptHeader,
        },
      });
      return response;
    } catch (error: any) {
      this.handleQueryError(error);
    }
  }

  /**
   * Query for cloud-dedicated (influxdb3 client)
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
      error.response?.data?.error ||
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
   * Uses SHOW MEASUREMENTS for cloud-dedicated (HTTP), information_schema for others
   */
  async getMeasurements(database: string): Promise<MeasurementInfo[]> {
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.getMeasurementsCloudDedicated(database);
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
   * Get measurements for cloud-dedicated (HTTP client with InfluxQL)
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
   * Uses SHOW FIELD KEYS + SHOW TAG KEYS for cloud-dedicated (HTTP), information_schema for others
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
   * Get measurement schema for cloud-dedicated (HTTP client with InfluxQL)
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
        category: "time" | "tag" | "field";
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
            });
          });
        }
      }

      columns.unshift({
        name: "time",
        type: "timestamp",
        category: "time",
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
          let category: "time" | "tag" | "field" = "field";

          if (row.column_name === "time") {
            category = "time";
          } else if (row.data_type === "string" || row.data_type === "text") {
            category = "tag";
          }

          return {
            name: row.column_name,
            type: row.data_type,
            category,
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

            let category: "time" | "tag" | "field" = "field";

            if (columnName === "time") {
              category = "time";
            } else if (
              dataType?.includes("Dictionary") ||
              dataType === "string" ||
              dataType === "text"
            ) {
              category = "tag";
            }

            return {
              name: columnName,
              type: dataType,
              category,
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
