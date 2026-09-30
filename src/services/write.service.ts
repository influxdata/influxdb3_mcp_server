/**
 * InfluxDB Write Service
 *
 * Handles write operations using InfluxDB v3 line protocol API
 * Note: InfluxDB v3 only supports writing via line protocol - no UPDATE/DELETE operations
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import {
  classifiedError,
  normalizeError,
  rejectedLineNumbers,
  resolveErrorMessage,
} from "./error-resolution.service.js";

/** Server wording for a write rejected by an explicit-schema database (3.12+). */
const EXPLICIT_SCHEMA_REJECTION = /which uses explicit schemas/;
const PARTIAL_WRITE = "partial write of line protocol occurred";

export type Precision = "nanosecond" | "microsecond" | "millisecond" | "second";

export class WriteService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  /**
   * Map full precision names to cloud-compatible short format
   */
  private mapPrecisionForCloud(precision: Precision): string {
    const precisionMap: Record<Precision, string> = {
      nanosecond: "ns",
      microsecond: "us",
      millisecond: "ms",
      second: "s",
    };
    return precisionMap[precision];
  }

  /**
   * Write data (single entrypoint for all product types)
   * For core/enterprise: HTTP API (/api/v3/write_lp)
   * For cloud-dedicated: influxdb3 client
   * For clustered: HTTP API (/api/v2/write)
   * For cloud-serverless: influxdb3 client
   */
  async writeLineProtocol(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
    // Validate we have data capabilities for write operations
    this.baseService.validateDataCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.writeCloudDedicated(lineProtocolData, database, options);
      case InfluxProductType.Clustered:
        return this.writeClustered(lineProtocolData, database, options);
      case InfluxProductType.CloudServerless:
        return this.writeCloudServerless(lineProtocolData, database, options);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.writeCoreEnterprise(lineProtocolData, database, options);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Write for core/enterprise (HTTP API)
   */
  private async writeCoreEnterprise(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
    const { precision, acceptPartial = true, noSync = false } = options;
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const params = new URLSearchParams({
        db: database,
        precision,
        accept_partial: acceptPartial.toString(),
        no_sync: noSync.toString(),
      });
      await httpClient.post(
        `/api/v3/write_lp?${params.toString()}`,
        lineProtocolData,
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Accept: "application/json",
          },
        },
      );
    } catch (error: any) {
      this.handleWriteError(error, database);
    }
  }

  /**
   * Write for cloud-dedicated/clustered (influxdb3 client)
   */
  private async writeCloudDedicated(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const writeOptions: any = {};
      if (options.precision) {
        writeOptions.precision = options.precision;
      }
      await client.write(lineProtocolData, database, undefined, writeOptions);
    } catch (error: any) {
      this.handleWriteError(error, database);
    }
  }

  /**
   * Write for clustered (HTTP API)
   */
  private async writeClustered(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
    const { precision } = options;
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const params = new URLSearchParams({
        bucket: database,
        precision: this.mapPrecisionForCloud(precision),
      });
      await httpClient.post(
        `/api/v2/write?${params.toString()}`,
        lineProtocolData,
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Accept: "application/json",
          },
        },
      );
    } catch (error: any) {
      this.handleWriteError(error, database);
    }
  }

  /**
   * Write for cloud-serverless (influxdb3 client)
   */
  private async writeCloudServerless(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
    try {
      const client = this.baseService.getClient();
      if (!client) throw new Error("InfluxDB client not initialized");
      const writeOptions: any = {};
      if (options.precision) {
        writeOptions.precision = this.mapPrecisionForCloud(options.precision);
      }
      await client.write(lineProtocolData, database, undefined, writeOptions);
    } catch (error: any) {
      this.handleWriteError(error, database);
    }
  }

  /**
   * Centralized error handler for write methods
   */
  private handleWriteError(error: any, database: string): never {
    const { status, body } = normalizeError(error);
    const message = resolveErrorMessage(body, error.message);

    if (status === 400) {
      throw classifiedError(
        `Bad request: ${message}${this.partialWriteNote(body)}${
          EXPLICIT_SCHEMA_REJECTION.test(message)
            ? "\nHint: this database uses explicit schema mode (InfluxDB 3 Enterprise 3.12+), so writes can't create tables or columns. " +
              "Declare the missing table or column first (POST or PATCH /api/v3/configure/table, or the influxdb3 CLI), then resend the rejected lines. " +
              "This MCP server has no tool for declaring schema; ask the user or an operator to do it."
            : ""
        }`,
        EXPLICIT_SCHEMA_REJECTION.test(message)
          ? "write_schema_not_declared"
          : "write_bad_request",
        false,
      );
    }
    if (status === 403) {
      throw classifiedError(
        `Access denied: ${message}. The token doesn't have write permission for database '${database}' (for example, it's a read-only token). Do not retry with the same token.`,
        "access_denied",
        false,
      );
    }
    if (status === 429) {
      throw classifiedError(
        `Too many requests, retry the write after a short backoff: ${message}`,
        "write_backpressure",
        true,
      );
    }
    if (status === 503) {
      throw classifiedError(
        `Service temporarily unavailable, retry the write: ${message}`,
        "write_unavailable",
        true,
      );
    }
    const prefixes: Record<number, string> = {
      401: "Unauthorized",
      413: "Request entity too large",
      422: "Unprocessable entity",
    };
    if (status !== undefined && status in prefixes) {
      throw new Error(`${prefixes[status]}: ${message}`);
    }
    throw new Error(
      `Failed to write data to database '${database}': ${message}`,
    );
  }

  /**
   * Whether other lines of a rejected batch were stored. InfluxDB reports
   * `partial write of line protocol occurred` when accept_partial=true and
   * `line protocol parsing error` when the whole request was rejected.
   */
  private partialWriteNote(body: unknown): string {
    const lines = rejectedLineNumbers(body);
    if (lines.length === 0) return "";
    const listed = `rejected line numbers: ${lines.join(", ")}`;
    const isPartial =
      !!body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).error === PARTIAL_WRITE;
    return isPartial
      ? `\nPartial write: any other lines in the batch were written; resend only the rejected lines (${listed}).`
      : `\nNo lines from this request were written (${listed}).`;
  }
}
