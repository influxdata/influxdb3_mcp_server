/**
 * InfluxDB Cloud-Dedicated Token Management Service
 *
 * Handles database token operations for InfluxDB Cloud-Dedicated clusters
 * Uses REST API endpoints instead of SQL queries
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

export interface CloudTokenPermission {
  action: "read" | "write";
  resource: string;
}

export interface CloudTokenInfo {
  accountId: string;
  clusterId: string;
  id: string;
  description: string;
  permissions: CloudTokenPermission[];
  createdAt: string;
  accessToken?: string;
}

export interface CreateCloudTokenRequest {
  description: string;
  permissions: CloudTokenPermission[];
}

export interface UpdateCloudTokenRequest {
  description?: string;
  permissions?: CloudTokenPermission[];
}

export class CloudTokenManagementService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  /**
   * List all database tokens for the cloud-dedicated cluster
   * GET /api/v0/accounts/{accountId}/clusters/{clusterId}/tokens
   */
  async listTokens(): Promise<CloudTokenInfo[]> {
    this.baseService.validateOperationSupport("list_cloud_tokens", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.Clustered,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/tokens`;

      const response = await httpClient.get<CloudTokenInfo[]>(endpoint);
      return Array.isArray(response) ? response : [];
    } catch (error: any) {
      this.handleTokenError(error, "list tokens");
    }
  }

  /**
   * Get a specific token by ID
   * GET /api/v0/accounts/{accountId}/clusters/{clusterId}/tokens/{tokenId}
   */
  async getToken(tokenId: string): Promise<CloudTokenInfo> {
    this.baseService.validateOperationSupport("get_cloud_token", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.Clustered,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/tokens/${tokenId}`;

      const response = await httpClient.get<CloudTokenInfo>(endpoint);
      return response;
    } catch (error: any) {
      this.handleTokenError(error, `get token '${tokenId}'`);
    }
  }

  /**
   * Create a new database token
   * POST /api/v0/accounts/{accountId}/clusters/{clusterId}/tokens
   */
  async createToken(request: CreateCloudTokenRequest): Promise<CloudTokenInfo> {
    this.baseService.validateOperationSupport("create_cloud_token", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.Clustered,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/tokens`;

      const response = await httpClient.post<CloudTokenInfo>(endpoint, request);
      return response;
    } catch (error: any) {
      this.handleTokenError(error, `create token '${request.description}'`);
    }
  }

  /**
   * Update an existing token
   * PATCH /api/v0/accounts/{accountId}/clusters/{clusterId}/tokens/{tokenId}
   */
  async updateToken(
    tokenId: string,
    request: UpdateCloudTokenRequest,
  ): Promise<CloudTokenInfo> {
    this.baseService.validateOperationSupport("update_cloud_token", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.Clustered,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/tokens/${tokenId}`;

      const response = await httpClient.patch<CloudTokenInfo>(
        endpoint,
        request,
      );
      return response;
    } catch (error: any) {
      this.handleTokenError(error, `update token '${tokenId}'`);
    }
  }

  /**
   * Delete a token
   * DELETE /api/v0/accounts/{accountId}/clusters/{clusterId}/tokens/{tokenId}
   */
  async deleteToken(tokenId: string): Promise<boolean> {
    this.baseService.validateOperationSupport("delete_cloud_token", [
      InfluxProductType.CloudDedicated,
      InfluxProductType.Clustered,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);
      const config = this.baseService.getConfig();

      const endpoint = `/api/v0/accounts/${config.influx.account_id}/clusters/${config.influx.cluster_id}/tokens/${tokenId}`;

      await httpClient.delete(endpoint);
      return true;
    } catch (error: any) {
      this.handleTokenError(error, `delete token '${tokenId}'`);
    }
  }

  /**
   * Helper method to create permissions for specific databases and actions
   */
  createPermissions(
    databases: string[],
    actions: ("read" | "write")[],
  ): CloudTokenPermission[] {
    const permissions: CloudTokenPermission[] = [];

    for (const database of databases) {
      for (const action of actions) {
        permissions.push({
          action,
          resource: database,
        });
      }
    }

    return permissions;
  }

  /**
   * Common error handling for token operations
   */
  private handleTokenError(error: any, operation: string): never {
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
          formatError(
            "Unauthorized: Check your InfluxDB management token permissions",
          ),
        );

      case 403:
        throw new Error(
          formatError(
            "Forbidden: Management token does not have sufficient permissions",
          ),
        );

      case 404:
        throw new Error(
          formatError(
            "Not Found: Token does not exist or endpoint not available",
          ),
        );

      case 409:
        throw new Error(
          formatError(
            "Conflict: Token already exists or operation conflicts with current state",
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
            "Connection refused: Check if InfluxDB Cloud console is accessible",
          );
        } else if (error.code === "ENOTFOUND") {
          throw new Error(
            "Host not found: Check your InfluxDB Cloud console URL",
          );
        } else if (error.response?.data) {
          const message =
            originalMessage || JSON.stringify(error.response.data);
          throw new Error(
            `HTTP ${status} - InfluxDB Cloud API error: ${message}`,
          );
        } else {
          throw new Error(`Failed to ${operation}: ${error.message}`);
        }
    }
  }
}
