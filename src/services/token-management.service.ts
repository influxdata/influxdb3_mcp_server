/**
 * InfluxDB Token Management Service
 *
 * Simplified service for essential token operations based on InfluxDB 3 Enterprise API
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

export interface TokenInfo {
  id: string;
  name: string;
  description?: string;
  permissions: string;
  created?: Date;
  expires?: Date;
  status: "active" | "inactive";
  type: "admin" | "resource";
}

export interface TokenPermission {
  resource_type: "db" | "system";
  resource_names: string[];
  actions: ("read" | "write")[];
}

export interface CreateResourceTokenRequest {
  token_name: string;
  permissions: TokenPermission[];
  expiry_secs?: number;
}

export interface CreateAdminTokenRequest {
  token_name?: string;
  expiry_secs?: number;
}

export class TokenManagementService {
  private baseService: BaseConnectionService;
  private httpClient: any;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
    this.httpClient = baseService.getInfluxHttpClient();
  }

  /**
   * Create a new admin token with full permissions
   */
  async createAdminToken(
    token_name?: string,
    expiry_secs?: number,
  ): Promise<{ token: string; id: string }> {
    this.baseService.validateOperationSupport("create_admin_token", [
      InfluxProductType.Core,
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const name =
        token_name ||
        `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestBody: CreateAdminTokenRequest = { token_name: name };
      if (expiry_secs !== undefined) {
        requestBody.expiry_secs = expiry_secs;
      }

      const response = await this.httpClient.post(
        "/api/v3/configure/token/named_admin",
        requestBody,
      );

      if (response && response.token) {
        return {
          token: response.token,
          id: response.id || response.token_id || "unknown",
        };
      } else {
        throw new Error(
          "Admin token creation failed: No token returned in response",
        );
      }
    } catch (error: any) {
      const errorMessage = error.response?.data || error.message;
      const statusCode = error.response?.status;
      throw new Error(
        `Failed to create admin token: ${errorMessage} (Status: ${statusCode})`,
      );
    }
  }

  /**
   * List admin tokens with optional filtering
   */
  async listAdminTokens(filters?: {
    tokenName?: string;
    order?: {
      field: "created_at" | "token_id" | "name";
      direction: "ASC" | "DESC";
    };
  }): Promise<any> {
    this.baseService.validateOperationSupport("list_admin_tokens", [
      InfluxProductType.Core,
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      let query =
        "SELECT * FROM system.tokens WHERE permissions LIKE '%*:*:*%'";

      if (filters?.tokenName) {
        query += ` AND name LIKE '%${filters.tokenName}%'`;
      }

      if (filters?.order) {
        query += ` ORDER BY ${filters.order.field} ${filters.order.direction}`;
      } else {
        query += " ORDER BY token_id ASC";
      }

      const payload = {
        db: "_internal",
        q: query,
        format: "json",
        params: {},
      };

      const response = await this.httpClient.post(
        "/api/v3/query_sql",
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      return response;
    } catch (error: any) {
      const errorMessage = error.response?.data;
      const _statusCode = error.response?.status;
      throw new Error(
        `Failed to list admin tokens: ${errorMessage || error.message}`,
      );
    }
  }

  /**
   * List resource tokens with optional filtering
   */
  async listResourceTokens(filters?: {
    databaseName?: string;
    tokenName?: string;
    order?: {
      field: "created_at" | "token_id" | "name";
      direction: "ASC" | "DESC";
    };
  }): Promise<any> {
    this.baseService.validateOperationSupport("list_resource_tokens", [
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      let query =
        "SELECT * FROM system.tokens WHERE permissions NOT LIKE '%*:*:*%'";

      if (filters?.databaseName) {
        query += ` AND permissions LIKE '%${filters.databaseName}%'`;
      }

      if (filters?.tokenName) {
        query += ` AND name LIKE '%${filters.tokenName}%'`;
      }

      if (filters?.order) {
        query += ` ORDER BY ${filters.order.field} ${filters.order.direction}`;
      } else {
        query += " ORDER BY token_id ASC";
      }

      const payload = {
        db: "_internal",
        q: query,
        format: "json",
        params: {},
      };

      const response = await this.httpClient.post(
        "/api/v3/query_sql",
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      return response;
    } catch (error: any) {
      const errorMessage =
        error.response?.data || error.response?.statusText || error.message;
      const statusCode = error.response?.status;
      throw new Error(
        `Failed to list resource tokens: Status: ${statusCode}, Message: ${errorMessage}`,
      );
    }
  }

  /**
   * Regenerate the operator token
   */
  async regenerateOperatorToken(): Promise<{ token: string; id: string }> {
    this.baseService.validateOperationSupport("regenerate_operator_token", [
      InfluxProductType.Core,
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const response = await this.httpClient.post(
        "/api/v3/configure/token/admin/regenerate",
      );

      if (response && response.token) {
        return {
          token: response.token,
          id: response.id || response.token_id || "operator",
        };
      } else {
        throw new Error(
          "Operator token regeneration failed: No token returned in response",
        );
      }
    } catch (error: any) {
      const errorMessage = error.response?.data || error.message;
      const statusCode = error.response?.status;
      throw new Error(
        `Failed to regenerate operator token: ${errorMessage} (Status: ${statusCode})`,
      );
    }
  }

  /**
   * Create a new resource token with specific database permissions
   */
  async createResourceToken(
    description: string,
    permissions: TokenPermission[],
    expiry_secs?: number,
  ): Promise<{ token: string; id: string }> {
    this.baseService.validateOperationSupport("create_resource_token", [
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const requestBody: CreateResourceTokenRequest = {
        token_name: description,
        permissions: permissions,
      };
      if (expiry_secs) {
        requestBody.expiry_secs = expiry_secs;
      }
      const influxType = this.baseService.getConnectionInfo().type;
      const endpoint =
        influxType === "enterprise"
          ? "/api/v3/enterprise/configure/token"
          : "/api/v3/configure/token";
      const response = await this.httpClient.post(endpoint, requestBody);
      if (response && response.token) {
        return {
          token: response.token,
          id: response.id || response.token_id || "unknown",
        };
      } else {
        throw new Error(
          "Resource token creation failed: No token returned in response",
        );
      }
    } catch (error: any) {
      const errorMessage = error.response?.data || error.message;
      const statusCode = error.response?.status;
      throw new Error(
        `Failed to create resource token: ${errorMessage} (Status: ${statusCode})`,
      );
    }
  }

  /**
   * Delete a token by name
   */
  async deleteToken(token_name: string): Promise<boolean> {
    if (!token_name) throw new Error("token_name is required");
    this.baseService.validateOperationSupport("delete_token", [
      InfluxProductType.Core,
      InfluxProductType.Enterprise,
    ]);
    this.baseService.validateManagementCapabilities();

    try {
      const response = await this.httpClient.delete("/api/v3/configure/token", {
        params: { token_name },
      });
      return response?.success !== false;
    } catch (error: any) {
      const errorMessage = error.response?.data || error.message;
      const statusCode = error.response?.status;
      throw new Error(
        `Failed to delete token: ${errorMessage} (Status: ${statusCode})`,
      );
    }
  }
}
