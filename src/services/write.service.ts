/**
 * InfluxDB Write Service
 *
 * Handles write operations using InfluxDB v3 line protocol API
 * Note: InfluxDB v3 only supports writing via line protocol - no UPDATE/DELETE operations
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

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
    if (error.response?.status === 400) {
      throw new Error(
        `Bad request: Invalid line protocol format or parameters`,
      );
    } else if (error.response?.status === 401) {
      throw new Error("Unauthorized: Check your InfluxDB token permissions");
    } else if (error.response?.status === 403) {
      throw new Error(
        "Access denied: Insufficient permissions for database operations",
      );
    } else if (error.response?.status === 413) {
      throw new Error(
        "Request entity too large: Reduce the size of your line protocol data",
      );
    } else if (error.response?.status === 422) {
      throw new Error("Unprocessable entity: Invalid line protocol syntax");
    }
    throw new Error(
      `Failed to write data to database '${database}': ${error.response?.data || error.message}`,
    );
  }
}
