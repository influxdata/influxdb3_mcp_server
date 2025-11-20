/**
 * Base InfluxDB Connection Service
 *
 * Handles connection management, health checks, and provides base client access
 * for other specialized services
 */

import { InfluxDBClient } from "@influxdata/influxdb3-client";
import { InfluxConfig, McpServerConfig } from "../config.js";
import { HttpClientService } from "./http-client.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

export interface ConnectionInfo {
  isDataClientInitialized: boolean;
  url: string;
  hasToken: boolean;
  database?: string;
  type?: string;
}

export class BaseConnectionService {
  private client: InfluxDBClient | null = null;
  private config: McpServerConfig;
  private httpClient: HttpClientService;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.httpClient = new HttpClientService();
    this.initializeClient();
  }

  /**
   * Get the correct host for query/write operations (data plane)
   */
  private getDataHost(): string | undefined {
    const influx = this.config.influx;
    if (influx.type === InfluxProductType.CloudDedicated && influx.cluster_id) {
      return `https://${influx.cluster_id}.a.influxdb.io`;
    }
    if (influx.type === InfluxProductType.CloudServerless) {
      return influx.url;
    }
    return influx.url;
  }

  /**
   * Get the correct host for management operations (control plane)
   */
  private getManagementHost(): string | undefined {
    const influx = this.config.influx;
    if (influx.type === InfluxProductType.CloudDedicated) {
      return "https://console.influxdata.com";
    }
    if (influx.type === InfluxProductType.CloudServerless) {
      return influx.url;
    }
    return influx.url;
  }

  /**
   * Initialize InfluxDB client
   */
  private initializeClient(): void {
    try {
      const influxConfig = this.config.influx;
      if (this.isValidConfig(influxConfig)) {
        const clientConfig: any = {
          host: this.getDataHost(),
          token: influxConfig.token,
        };
        this.client = new InfluxDBClient(clientConfig);
      }
    } catch (error) {
      console.error("Failed to initialize InfluxDB client:", error);
      this.client = null;
    }
  }
  /**
   * Check if configuration is valid for data operations (requires data client)
   */
  private isValidConfig(config: InfluxConfig): boolean {
    if (config.type === InfluxProductType.CloudDedicated) {
      return !!(config.cluster_id && config.token);
    }
    if (config.type === InfluxProductType.CloudServerless) {
      return !!(config.url && config.token);
    }
    return !!(config.url && config.token);
  }

  /**
   * Check if we have data capabilities (query/write operations)
   */
  hasDataCapabilities(): boolean {
    return this.isValidConfig(this.config.influx);
  }

  /**
   * Check if we have management capabilities
   */
  hasManagementCapabilities(): boolean {
    const config = this.config.influx;
    if (config.type === InfluxProductType.CloudDedicated) {
      return !!(
        config.cluster_id &&
        config.account_id &&
        config.management_token
      );
    }
    if (config.type === InfluxProductType.Clustered) {
      return !!config.management_token;
    }
    if (config.type === InfluxProductType.CloudServerless) {
      return !!(config.url && config.token);
    }
    return !!(config.url && config.token);
  }

  /**
   * Validate that we can perform data operations (query/write)
   * Throws an error if we don't have the necessary configuration
   */
  validateDataCapabilities(): void {
    if (!this.hasDataCapabilities()) {
      const config = this.config.influx;
      if (config.type === InfluxProductType.CloudDedicated) {
        if (!config.cluster_id) {
          throw new Error(
            "Cloud Dedicated data operations require cluster_id in configuration",
          );
        }
        if (!config.token) {
          throw new Error(
            "Cloud Dedicated data operations require database token in configuration",
          );
        }
      } else if (config.type === InfluxProductType.CloudServerless) {
        if (!config.url) {
          throw new Error(
            "Cloud Serverless data operations require url (region-specific endpoint) in configuration",
          );
        }
        if (!config.token) {
          throw new Error(
            "Cloud Serverless data operations require database token in configuration",
          );
        }
      } else {
        if (!config.url) {
          throw new Error(
            "Core/Enterprise data operations require url in configuration",
          );
        }
        if (!config.token) {
          throw new Error(
            "Core/Enterprise data operations require token in configuration",
          );
        }
      }
    }
  }

  /**
   * Validate that we can perform management operations
   * Throws an error if we don't have the necessary configuration
   */
  validateManagementCapabilities(): void {
    if (!this.hasManagementCapabilities()) {
      const config = this.config.influx;
      if (
        config.type === InfluxProductType.CloudDedicated ||
        config.type === InfluxProductType.Clustered
      ) {
        const missing = [];
        if (!config.cluster_id) missing.push("cluster_id");
        if (!config.account_id) missing.push("account_id");
        if (!config.management_token) missing.push("management_token");
        throw new Error(
          `Cloud Dedicated/Clustered management operations require: ${missing.join(", ")}`,
        );
      } else if (config.type === InfluxProductType.CloudServerless) {
        if (!config.url) {
          throw new Error(
            "Cloud Serverless management operations require url (region-specific endpoint) in configuration",
          );
        }
        if (!config.token) {
          throw new Error(
            "Cloud Serverless management operations require database token in configuration",
          );
        }
      } else {
        if (!config.url) {
          throw new Error(
            "Core/Enterprise management operations require url in configuration",
          );
        }
        if (!config.token) {
          throw new Error(
            "Core/Enterprise management operations require token with management permissions",
          );
        }
      }
    }
  }

  /**
   * Validate operation is supported for current product type
   */
  validateOperationSupport(
    operation: string,
    supportedTypes: InfluxProductType[],
  ): void {
    const currentType = this.config.influx.type as InfluxProductType;
    if (!supportedTypes.includes(currentType)) {
      const supportedNames = supportedTypes
        .map((type) => {
          switch (type) {
            case InfluxProductType.Core:
              return "Core";
            case InfluxProductType.Enterprise:
              return "Enterprise";
            case InfluxProductType.CloudDedicated:
              return "Cloud Dedicated";
            case InfluxProductType.CloudServerless:
              return "Cloud Serverless";
            case InfluxProductType.Clustered:
              return "Clustered";
            default:
              return type;
          }
        })
        .join(", ");

      const currentName =
        currentType === InfluxProductType.Core
          ? "Core"
          : currentType === InfluxProductType.Enterprise
            ? "Enterprise"
            : currentType === InfluxProductType.CloudDedicated
              ? "Cloud Dedicated"
              : currentType === InfluxProductType.CloudServerless
                ? "Cloud Serverless"
                : currentType === InfluxProductType.Clustered
                  ? "Clustered"
                  : currentType;

      throw new Error(
        `Operation '${operation}' is not supported for ${currentName}. Supported types: ${supportedNames}`,
      );
    }
  }

  /**
   * Get the main client instance
   */
  getClient(): InfluxDBClient | null {
    return this.client;
  }

  /**
   * Get connection information
   */
  getConnectionInfo(): ConnectionInfo {
    const influxConfig = this.config.influx;
    return {
      isDataClientInitialized: !!this.client,
      url: this.getDataHost() || "",
      hasToken: !!influxConfig.token,
      type: influxConfig.type,
    };
  }

  /**
   * Ping InfluxDB instance (returns version and build info if available)
   */
  async ping(): Promise<{
    ok: boolean;
    version?: string;
    build?: string;
    message?: string;
  }> {
    const url = this.getDataHost();
    if (!url) {
      return { ok: false, message: "No data host configured" };
    }
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/ping`, {
        headers: {
          Authorization: `Token ${this.config.influx.token}`,
        },
      });
      if (response.ok) {
        const version = response.headers.get("x-influxdb-version") || undefined;
        let build = response.headers.get("x-influxdb-build") || undefined;
        if (!build) {
          if (version) {
            build = "Other";
          }
        }
        return { ok: true, version, build };
      } else {
        return {
          ok: false,
          message: `Ping failed with status ${response.status}`,
        };
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<{ status: string; checks?: any[] }> {
    const url = this.getDataHost();
    if (!url || !this.client) {
      return { status: "fail" };
    }
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
        headers: {
          Authorization: `Token ${this.config.influx.token}`,
        },
      });
      if (response.ok) {
        try {
          const healthData = await response.json();
          return healthData;
        } catch {
          return { status: "pass" };
        }
      } else {
        return { status: "fail" };
      }
    } catch (_error) {
      return { status: "fail" };
    }
  }

  /**
   * Get pre-configured HTTP client for InfluxDB API calls
   * For cloud-dedicated, use data host for query/write, management host for admin
   */
  getInfluxHttpClient(forManagement = false): HttpClientService {
    const influxConfig = this.config.influx;
    const host =
      (forManagement ? this.getManagementHost() : this.getDataHost()) || "";

    let token: string = "";
    if (
      forManagement &&
      (influxConfig.type === InfluxProductType.CloudDedicated ||
        influxConfig.type === InfluxProductType.Clustered)
    ) {
      token = influxConfig.management_token || "";
    } else {
      token = influxConfig.token || "";
    }

    return HttpClientService.createInfluxClient(host, token, influxConfig.type);
  }

  /**
   * Get configuration
   */
  getConfig(): McpServerConfig {
    return this.config;
  }
}
