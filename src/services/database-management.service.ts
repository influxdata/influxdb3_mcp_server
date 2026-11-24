import { resolveOperationError } from "./error-resolution.service.js";

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

export interface CloudServerlessBucketConfig {
  name?: string;
  description?: string;
  retentionPeriod?: number;
}

const NANOSECONDS_PER_SECOND = 1_000_000_000;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

function warnAboutSettingsCoreEnterpriseIgnores(
  config: Partial<CloudDedicatedDatabaseConfig>,
): void {
  if (
    config.maxTables !== undefined ||
    config.maxColumnsPerTable !== undefined
  ) {
    console.warn(
      "Warning: maxTables and maxColumnsPerTable are not supported for Core/Enterprise. Only retentionPeriod is supported.",
    );
  }
}

function formatRetentionAsWholeDaysOrHours(retentionPeriodNs: number): string {
  const seconds = Math.floor(retentionPeriodNs / NANOSECONDS_PER_SECOND);
  const hours = seconds / SECONDS_PER_HOUR;

  if (hours < 1) {
    throw new Error(
      "retentionPeriod must be at least 1 hour (3600000000000 ns) for Core/Enterprise.",
    );
  }

  if (hours % HOURS_PER_DAY === 0) {
    return `${hours / HOURS_PER_DAY}d`;
  }

  return `${Math.floor(hours)}h`;
}

export class DatabaseManagementService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.listDatabasesCloudDedicated();
      case InfluxProductType.CloudServerless:
        return this.listDatabasesCloudServerless();
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.listDatabasesCoreEnterprise();
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  async createDatabase(
    name: string,
    config?: CloudDedicatedDatabaseConfig | CloudServerlessBucketConfig,
  ): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.createDatabaseCloudDedicated(
          name,
          config as CloudDedicatedDatabaseConfig,
        );
      case InfluxProductType.CloudServerless:
        return this.createDatabaseCloudServerless(
          name,
          config as CloudServerlessBucketConfig,
        );
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.createDatabaseCoreEnterprise(name);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  async updateDatabase(
    name: string,
    config:
      | Partial<CloudDedicatedDatabaseConfig>
      | Partial<CloudServerlessBucketConfig>,
  ): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateOperationSupport("update_database", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.CloudServerless,
      InfluxProductType.Clustered,
      InfluxProductType.Core,
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.updateDatabaseCloudDedicated(
          name,
          config as Partial<CloudDedicatedDatabaseConfig>,
        );
      case InfluxProductType.CloudServerless:
        return this.updateDatabaseCloudServerless(
          name,
          config as Partial<CloudServerlessBucketConfig>,
        );
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.updateDatabaseCoreEnterprise(name, config);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

  async deleteDatabase(name: string): Promise<boolean> {
    if (!name) throw new Error("Database name is required");
    this.baseService.validateManagementCapabilities();

    const connectionInfo = this.baseService.getConnectionInfo();
    switch (connectionInfo.type) {
      case InfluxProductType.CloudDedicated:
      case InfluxProductType.Clustered:
        return this.deleteDatabaseCloudDedicated(name);
      case InfluxProductType.CloudServerless:
        return this.deleteDatabaseCloudServerless(name);
      case InfluxProductType.Core:
      case InfluxProductType.Enterprise:
        return this.deleteDatabaseCoreEnterprise(name);
      default:
        throw new Error(
          `Unsupported InfluxDB product type: ${connectionInfo.type}`,
        );
    }
  }

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
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

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
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

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

  private async updateDatabaseCoreEnterprise(
    name: string,
    config: Partial<CloudDedicatedDatabaseConfig>,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient();
      const endpoint = `/api/v3/configure/database`;

      warnAboutSettingsCoreEnterpriseIgnores(config);

      if (config.retentionPeriod === undefined) {
        throw new Error(
          "No valid configuration parameters provided for Core/Enterprise update. Only retentionPeriod is supported.",
        );
      }

      const payload = {
        db: name,
        retention_period: formatRetentionAsWholeDaysOrHours(
          config.retentionPeriod,
        ),
      };

      await httpClient.put(endpoint, payload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `update database '${name}'`);
    }
  }

  private async listDatabasesCloudServerless(): Promise<DatabaseInfo[]> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(false);

      const response = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );

      if (!response || typeof response !== "object") {
        throw new Error(
          "Invalid response format from InfluxDB Cloud Serverless API",
        );
      }

      let buckets: any[] = [];
      if (Array.isArray(response.buckets)) {
        buckets = response.buckets;
      } else if (Array.isArray(response)) {
        buckets = response as any[];
      } else {
        const possibleBuckets =
          (response as any).data?.buckets ||
          (response as any).result?.buckets ||
          (response as any).buckets;
        if (Array.isArray(possibleBuckets)) {
          buckets = possibleBuckets;
        } else {
          throw new Error(
            `Unexpected response structure: ${JSON.stringify(response)}`,
          );
        }
      }

      return buckets
        .filter((bucket) => bucket.type !== "system")
        .map((bucket) => {
          if (typeof bucket === "string") {
            return { name: bucket };
          } else if (bucket && typeof bucket === "object" && bucket.name) {
            const databaseInfo: DatabaseInfo = {
              name: bucket.name,
              retentionPeriod: bucket.retentionRules?.[0]?.everySeconds
                ? bucket.retentionRules[0].everySeconds * 1000000000
                : undefined,
            };

            if (bucket.id) {
              (databaseInfo as any).bucketId = bucket.id;
            }
            if (bucket.orgID) {
              (databaseInfo as any).organizationId = bucket.orgID;
            }
            if (bucket.storageType) {
              (databaseInfo as any).storageType = bucket.storageType;
            }
            if (bucket.createdAt) {
              (databaseInfo as any).createdAt = bucket.createdAt;
            }
            if (bucket.updatedAt) {
              (databaseInfo as any).updatedAt = bucket.updatedAt;
            }
            if (bucket.description) {
              (databaseInfo as any).description = bucket.description;
            }
            if (bucket.rp) {
              (databaseInfo as any).retentionPolicy = bucket.rp;
            }

            return databaseInfo;
          } else {
            return { name: String(bucket) };
          }
        });
    } catch (error: any) {
      throw resolveOperationError(error, "metadata_unavailable");
    }
  }

  private async createDatabaseCloudServerless(
    name: string,
    config?: CloudServerlessBucketConfig,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(false);

      const orgsResponse = await httpClient.get<{ orgs?: any[] }>(
        "/api/v2/orgs",
      );
      let orgID: string;

      if (orgsResponse?.orgs && orgsResponse.orgs.length > 0) {
        orgID = orgsResponse.orgs[0].id;
      } else {
        throw new Error("Could not find organization ID for bucket creation");
      }

      const payload: any = {
        name,
        orgID,
        retentionRules: [
          {
            type: "expire",
            everySeconds: config?.retentionPeriod
              ? Math.floor(config.retentionPeriod / 1000000000)
              : 2592000,
          },
        ],
      };

      if (config?.description) {
        payload.description = config.description;
      }

      await httpClient.post("/api/v2/buckets", payload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `create database (bucket) '${name}'`);
    }
  }

  private async deleteDatabaseCloudServerless(name: string): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(false);

      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucketID: string | undefined;

      if (bucketsResponse?.buckets) {
        const bucket = bucketsResponse.buckets.find(
          (b) => b.name === name && b.type !== "system",
        );
        if (bucket) {
          bucketID = bucket.id;
        }
      }

      if (!bucketID) {
        throw new Error(`Database (bucket) '${name}' not found`);
      }

      await httpClient.delete(`/api/v2/buckets/${bucketID}`);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `delete database (bucket) '${name}'`);
    }
  }

  private async updateDatabaseCloudServerless(
    name: string,
    config: Partial<CloudServerlessBucketConfig>,
  ): Promise<boolean> {
    try {
      const httpClient = this.baseService.getInfluxHttpClient(false);

      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucket: any;

      if (bucketsResponse?.buckets) {
        bucket = bucketsResponse.buckets.find(
          (b) => b.name === name && b.type !== "system",
        );
      }

      if (!bucket) {
        throw new Error(`Database (bucket) '${name}' not found`);
      }

      const updatePayload: any = {};

      if (config.name && config.name !== bucket.name) {
        updatePayload.name = config.name;
      }

      if (config.description !== undefined) {
        updatePayload.description = config.description;
      }

      if (config.retentionPeriod !== undefined) {
        updatePayload.retentionRules = [
          {
            type: "expire",
            everySeconds: Math.floor(config.retentionPeriod / 1000000000),
          },
        ];
      } else {
        updatePayload.retentionRules = bucket.retentionRules || [
          {
            type: "expire",
            everySeconds: 2592000,
          },
        ];
      }

      if (
        !updatePayload.retentionRules ||
        updatePayload.retentionRules.length === 0
      ) {
        updatePayload.retentionRules = [
          {
            type: "expire",
            everySeconds: 2592000,
          },
        ];
      }

      await httpClient.patch(`/api/v2/buckets/${bucket.id}`, updatePayload);
      return true;
    } catch (error: any) {
      this.handleDatabaseError(error, `update database (bucket) '${name}'`);
    }
  }

  private handleDatabaseError(error: any, operation: string): never {
    const status = error.response?.status;
    const originalMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      (typeof error.response?.data === "string" ? error.response.data : null) ||
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
