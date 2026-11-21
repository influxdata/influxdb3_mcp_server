import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { resolveWriteError } from "./error-resolution.service.js";

export type Precision = "nanosecond" | "microsecond" | "millisecond" | "second";

export class WriteService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  private toShortPrecisionUnit(precision: Precision): string {
    const precisionMap: Record<Precision, string> = {
      nanosecond: "ns",
      microsecond: "us",
      millisecond: "ms",
      second: "s",
    };
    return precisionMap[precision];
  }

  async writeLineProtocol(
    lineProtocolData: string,
    database: string,
    options: {
      precision: Precision;
      acceptPartial?: boolean;
      noSync?: boolean;
    },
  ): Promise<void> {
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
      this.handleWriteError(error, database, {
        lineProtocol: lineProtocolData,
        acceptPartial,
      });
    }
  }

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
        writeOptions.precision = this.toShortPrecisionUnit(options.precision);
      }
      await client.write(lineProtocolData, database, undefined, writeOptions);
    } catch (error: any) {
      this.handleWriteError(error, database, {
        lineProtocol: lineProtocolData,
      });
    }
  }

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
        precision: this.toShortPrecisionUnit(precision),
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
      this.handleWriteError(error, database, {
        lineProtocol: lineProtocolData,
      });
    }
  }

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
        writeOptions.precision = this.toShortPrecisionUnit(options.precision);
      }
      await client.write(lineProtocolData, database, undefined, writeOptions);
    } catch (error: any) {
      this.handleWriteError(error, database, {
        lineProtocol: lineProtocolData,
      });
    }
  }

  /**
   * Centralized error handler for write methods
   */
  private handleWriteError(
    error: any,
    database: string,
    request: { lineProtocol: string; acceptPartial?: boolean },
  ): never {
    throw resolveWriteError(error, database, request);
  }
}
