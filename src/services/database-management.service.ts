/**
 * InfluxDB Database Management Service
 *
 * Handles database lifecycle operations: list, create, delete, update
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

export interface DatabaseInfo {
  name: string;
  maxTables?: number;
  maxColumnsPerTable?: number;
  retentionPeriod?: number;
}

export interface CloudDedicatedDatabaseConfig {
  name: string;
  maxTables?: number;
  maxColumnsPerTable?: number;
  retentionPeriod?: number;
}

export class DatabaseManagementService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  /**
   * List all databases (single entrypoint for all product types)
   * For core/enterprise: GET /api/v3/configure/database?format=json
   * For cloud-dedicated: GET /api/v0/accounts/{account_id}/clusters/{cluster_id}/databases
   */
  async listDatabases(): Promise<DatabaseInfo[]> {
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.listDatabasesCloudDedicated();
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.listDatabasesCoreEnterprise();
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Create a new database (single entrypoint for all product types)
   * For core/enterprise: POST /api/v3/configure/database
   * For cloud-dedicated: POST /api/v0/accounts/{account_id}/clusters/{cluster_id}/databases
   */
  async createDatabase(
    name: string,
    config?: CloudDedicatedDatabaseConfig,
  ): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.createDatabaseCloudDedicated(name, config);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.createDatabaseCoreEnterprise(name);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Update database configuration
   * For cloud-dedicated: PATCH /api/v0/accounts/{account_id}/clusters/{cluster_id}/databases/{name}
   * For core/enterprise: PATCH /api/v3/configure/database/{name}
   */
  async updateDatabase(
    name: string,
    config: Partial<CloudDedicatedDatabaseConfig>,
  ): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.updateDatabaseCloudDedicated(name, config);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.updateDatabaseCoreEnterprise(name, config);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * Delete a database (single entrypoint for all product types)
   * For core/enterprise: DELETE /api/v3/configure/database?db={name}
   * For cloud-dedicated: DELETE /api/v0/accounts/{account_id}/clusters/{cluster_id}/databases/{name}
   */
  async deleteDatabase(name: string): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
        return this.deleteDatabaseCloudDedicated(name);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.deleteDatabaseCoreEnterprise(name);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  /**
   * List databases for cloud-dedicated
   */
  private async listDatabasesCloudDedicated(): Promise<DatabaseInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/databases`;
      const response = await httpClient.get<{ databases?: any[] }>(endpoint);

      if (!response || typeof response !== "object") {
        throw new Error("Invalid response format from InfluxDB Cloud API");
      }

      let databases: any[] = [];
      if (Array.isArray(response.databases)) {
        databases = response.databases;
      } else if (Array.isArray(response)) {
        databases = response as any[];
      } else {
        const possibleDatabases =
          (response as any).data?.databases ||
          (response as any).result?.databases ||
          (response as any).databases;
        if (Array.isArray(possibleDatabases)) {
          databases = possibleDatabases;
        } else {
          throw new Error(
            `Unexpected response structure: ${JSON.stringify(response)}`,
          );
        }
      }

      return databases.map((item) => {
        if (typeof item === "string") {
          return { name: item };
        } else if (item && typeof item === "object" && item.name) {
          return {
            name: item.name,
            maxTables: item.maxTables,
            maxColumnsPerTable: item.maxColumnsPerTable,
            retentionPeriod: item.retentionPeriod,
          };
        } else {
          return { name: String(item) };
        }
      });
    } catch (error: any) {
      this.handleDatabaseError(error, "list databases");
    }
  }

  /**
   * Create database for cloud-dedicated
   */
  private async createDatabaseCloudDedicated(
    name: string,
    config?: CloudDedicatedDatabaseConfig,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const baseConfig = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${baseConfig.influx.account_id}/clusters/${baseConfig.influx.cluster_id}/databases`;

      const payload: any = { name };

      if (config?.maxTables !== undefined) {
        payload.maxTables = config.maxTables;
      } else {
        payload.maxTables = 500;
      }

      if (config?.maxColumnsPerTable !== undefined) {
        payload.maxColumnsPerTable = config.maxColumnsPerTable;
      } else {
        payload.maxColumnsPerTable = 200;
      }

      if (config?.retentionPeriod !== undefined) {
        payload.retentionPeriod = config.retentionPeriod;
      } else {
        payload.retentionPeriod = 0;
      }

      await httpClient.post(endpoint, payload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `create database '${name}'`);
    }
  }

  /**
   * Update database configuration for cloud-dedicated
   */
  private async updateDatabaseCloudDedicated(
    name: string,
    config: Partial<CloudDedicatedDatabaseConfig>,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const baseConfig = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${baseConfig.influx.account_id}/clusters/${baseConfig.influx.cluster_id}/databases/${encodeURIComponent(name)}`;

      const payload: any = {};

      if (config.maxTables !== undefined) {
        payload.maxTables = config.maxTables;
      }

      if (config.maxColumnsPerTable !== undefined) {
        payload.maxColumnsPerTable = config.maxColumnsPerTable;
      }

      if (config.retentionPeriod !== undefined) {
        payload.retentionPeriod = config.retentionPeriod;
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("No configuration parameters provided for update");
      }

      await httpClient.patch(endpoint, payload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `update database '${name}'`);
    }
  }

  /**
   * Delete database for cloud-dedicated
   */
  private async deleteDatabaseCloudDedicated(name: string): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/databases/${encodeURIComponent(name)}`;

      await httpClient.delete(endpoint);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `delete database '${name}'`);
    }
  }

  /**
   * List databases for core/enterprise
   */
  private async listDatabasesCoreEnterprise(): Promise<DatabaseInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const response = await httpClient.get<{ databases: string[] }>(
        "/api/v3/configure/database?format=json",
      );

      if (!response || typeof response !== "object") {
        throw new Error("Invalid response format from InfluxDB API");
      }

      let databases: any[] = [];

      if (Array.isArray(response.databases)) {
        databases = response.databases;
      } else if (Array.isArray(response)) {
        databases = response as any[];
      } else if (response && typeof response === "object") {
        const possibleDatabases =
          (response as any).data?.databases ||
          (response as any).result?.databases ||
          (response as any).databases;
        if (Array.isArray(possibleDatabases)) {
          databases = possibleDatabases;
        } else {
          throw new Error(
            `Unexpected response structure: ${JSON.stringify(response)}`,
          );
        }
      } else {
        throw new Error(
          `Unexpected response structure: ${JSON.stringify(response)}`,
        );
      }

      return databases.map((item) => {
        if (typeof item === "string") {
          return { name: item };
        } else if (item && typeof item === "object" && item["iox::database"]) {
          return { name: item["iox::database"] };
        } else if (item && typeof item === "object" && item.name) {
          return { name: item.name };
        } else {
          return { name: String(item) };
        }
      });
    } catch (error: any) {
      this.handleDatabaseError(error, "list databases");
    }
  }

  /**
   * Create database for core/enterprise
   */
  private async createDatabaseCoreEnterprise(name: string): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      await httpClient.post("/api/v3/configure/database", {
        db: name,
      });
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `create database '${name}'`);
    }
  }

  /**
   * Delete database for core/enterprise
   */
  private async deleteDatabaseCoreEnterprise(name: string): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      await httpClient.delete(
        `/api/v3/configure/database?db=${encodeURIComponent(name)}`,
      );
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `delete database '${name}'`);
    }
  }

  /**
   * Update database configuration for core/enterprise
   * Only supports retentionPeriod (retention_period)
   * Uses PUT /api/v3/configure/database with db and retention_period in body
   */
  private async updateDatabaseCoreEnterprise(
    name: string,
    config: Partial<CloudDedicatedDatabaseConfig>,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const endpoint = `/api/v3/configure/database`;

      const payload: any = {
        db: name
      };

      // Core/Enterprise only supports retention_period (not retention_period_ns)
      if (config.retentionPeriod !== undefined) {
        payload.retention_period = this.formatRetentionPeriod(config.retentionPeriod);
      }

      // Warn if unsupported parameters are provided
      if (config.maxTables !== undefined || config.maxColumnsPerTable !== undefined) {
        console.warn(
          "Warning: maxTables and maxColumnsPerTable are not supported for Core/Enterprise. Only retentionPeriod is supported."
        );
      }

      if (!payload.retention_period) {
        throw new Error(
          "No valid configuration parameters provided for Core/Enterprise update. Only retentionPeriod is supported."
        );
      }

      await httpClient.put(endpoint, payload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `update database '${name}'`);
    }
  }

  /**
   * Format retention period from nanoseconds to duration string (e.g., "7d", "1y")
   */
  private formatRetentionPeriod(retentionPeriodNs: number): string {
    const seconds = retentionPeriodNs / 1_000_000_000;
    const days = seconds / (24 * 60 * 60);
    
    // If exactly divisible by 365.25, use years
    if (days >= 365.25 && days % 365.25 === 0) {
      return `${Math.floor(days / 365.25)}y`;
    }
    
    // If exactly divisible by 30, use months (approximately)
    if (days >= 30 && days % 30 === 0) {
      return `${Math.floor(days / 30)}mo`;
    }
    
    // Otherwise use days
    return `${Math.floor(days)}d`;
  }

  /**
   * Common error handling for database operations with comprehensive status code handling
   */
  private handleDatabaseError(error: any, operation: string): never {
    const status = error.response?.status;
    const originalMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.response?.statusText;
    const statusText = error.response?.statusText || "";

    const formatError = (userMessage: string): string => {
      const parts = [`HTTP ${status}`, userMessage];
      if (originalMessage && originalMessage !== statusText) {
        parts.push(`Server message: ${originalMessage}`);
      }
      return parts.join(" - ");
    };

    switch (status) {
      case 400:
        throw new Error(
          formatError(
            "Bad Request: Invalid request parameters or malformed request",
          ),
        );

      case 401:
        throw new Error(
          formatError("Unauthorized: Check your InfluxDB token permissions"),
        );

      case 403:
        throw new Error(
          formatError(
            "Forbidden: Token does not have sufficient permissions for this operation",
          ),
        );

      case 404:
        throw new Error(
          formatError(
            "Not Found: Resource does not exist or endpoint not available",
          ),
        );

      case 409:
        throw new Error(
          formatError(
            "Conflict: Resource already exists or operation conflicts with current state",
          ),
        );

      case 500:
        throw new Error(
          formatError(
            "Internal Server Error: InfluxDB server encountered an error",
          ),
        );

      default:
        if (error.code === "ECONNREFUSED") {
          throw new Error(
            "Connection refused: Check if InfluxDB is running and URL is correct",
          );
        } else if (error.code === "ENOTFOUND") {
          throw new Error("Host not found: Check your InfluxDB URL");
        } else if (error.response?.data) {
          const message =
            originalMessage || JSON.stringify(error.response.data);
          throw new Error(`HTTP ${status} - InfluxDB API error: ${message}`);
        } else {
          throw new Error(`Failed to ${operation}: ${error.message}`);
        }
    }
  }
}
