import type { WritePrecision } from "@influxdata/influxdb3-client";
import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";
import { resolveWriteError } from "./error-resolution.service.js";

export type Precision = "nanosecond" | "microsecond" | "millisecond" | "second";

export interface LineProtocolWriteOptions {
  precision: Precision;
  acceptPartial?: boolean;
  noSync?: boolean;
}

const SHORT_PRECISION_UNIT: Record<Precision, WritePrecision> = {
  nanosecond: "ns",
  microsecond: "us",
  millisecond: "ms",
  second: "s",
};

const LINE_PROTOCOL_REQUEST_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  Accept: "application/json",
};

export class WriteService {
  constructor(private readonly baseService: BaseConnectionService) {}

  async writeLineProtocol(
    lineProtocol: string,
    database: string,
    options: LineProtocolWriteOptions,
  ): Promise<void> {
    this.baseService.validateDataCapabilities();
    const product = this.baseService.getConnectionInfo().type;
    const { precision, noSync = false } = options;

    let send: () => Promise<unknown>;
    let acceptPartial: boolean | undefined;
    switch (product) {
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        acceptPartial = options.acceptPartial ?? true;
        send = () =>
          this.postLineProtocol("/api/v3/write_lp", lineProtocol, {
            db: database,
            precision,
            accept_partial: String(acceptPartial),
            no_sync: String(noSync),
          });
        break;
      case InfluxProductType.Clustered:
        send = () =>
          this.postLineProtocol("/api/v2/write", lineProtocol, {
            bucket: database,
            precision: SHORT_PRECISION_UNIT[precision],
          });
        break;
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.CloudServerless:
        send = () =>
          this.writeThroughClientLibrary(lineProtocol, database, precision);
        break;
      default:
        throw new Error(`Unsupported InfluxDB product type: ${product}`);
    }

    try {
      await send();
    } catch (error) {
      throw resolveWriteError(error, database, { lineProtocol, acceptPartial });
    }
  }

  private postLineProtocol(
    path: string,
    lineProtocol: string,
    query: Record<string, string>,
  ): Promise<unknown> {
    return this.baseService
      .getInfluxHttpClient()
      .post(`${path}?${new URLSearchParams(query)}`, lineProtocol, {
        headers: LINE_PROTOCOL_REQUEST_HEADERS,
      });
  }

  private async writeThroughClientLibrary(
    lineProtocol: string,
    database: string,
    precision: Precision,
  ): Promise<void> {
    const client = this.baseService.getClient();
    if (!client) throw new Error("InfluxDB client not initialized");
    await client.write(lineProtocol, database, undefined, {
      precision: SHORT_PRECISION_UNIT[precision],
    });
  }
}
