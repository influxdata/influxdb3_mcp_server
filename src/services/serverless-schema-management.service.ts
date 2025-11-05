/**
 * InfluxDB Cloud Serverless Schema Management Service
 *
 * NOTE: As of Ocotber 2025, explicit schemas are not supported in InfluxDB v3 (Cloud Serverless).
 * This service and tools are preserved for potential future compatibility when
 * explicit schema support may be added to Cloud Serverless.
 *
 * For current schema exploration in Cloud Serverless, use the query-based tools:
 * - get_measurements: Lists all measurements using information_schema
 * - get_measurement_schema: Shows column details using information_schema
 *
 * This service provides schema management capabilities specific to InfluxDB Cloud Serverless,
 * including listing, creating, updating, and deleting measurement schemas within buckets.
 */

import { BaseConnectionService } from "./base-connection.service.js";
import { InfluxProductType } from "../helpers/enums/influx-product-types.enum.js";

export interface SchemaInfo {
  name: string;
  bucketId: string;
  bucketName: string;
  columns?: SchemaColumn[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SchemaColumn {
  name: string;
  type: "tag" | "field" | "timestamp";
  dataType?: "string" | "float" | "integer" | "boolean" | "time";
}

export interface CreateSchemaConfig {
  name: string;
  bucketName: string;
  columns: SchemaColumn[];
}

export interface UpdateSchemaConfig {
  columns?: SchemaColumn[];
}

export class SchemaManagementService {
  private baseService: BaseConnectionService;

  constructor(baseService: BaseConnectionService) {
    this.baseService = baseService;
  }

  /**
   * Validate that schema operations are supported (Cloud Serverless only)
   */
  private validateSchemaOperationSupport(): void {
    const connectionInfo = this.baseService.getConnectionInfo();
    if (connectionInfo.type !== InfluxProductType.CloudServerless) {
      throw new Error(
        `Schema management is only supported for Cloud Serverless. Current type: ${connectionInfo.type}`,
      );
    }
    this.baseService.validateManagementCapabilities();
  }

  /**
   * List all measurement schemas in a bucket
   * GET /api/v2/buckets/{bucketID}/schema/measurements
   */
  async listSchemas(bucketName: string): Promise<SchemaInfo[]> {
    this.validateSchemaOperationSupport();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);

      // First, get the bucket ID by name
      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucketId: string | undefined;

      if (bucketsResponse?.buckets) {
        const bucket = bucketsResponse.buckets.find(
          (b) => b.name === bucketName && b.type !== "system",
        );
        if (bucket) {
          bucketId = bucket.id;
        }
      }

      if (!bucketId) {
        throw new Error(`Bucket '${bucketName}' not found`);
      }

      const endpoint = `/api/v2/buckets/${bucketId}/schema/measurements`;
      const response = await httpClient.get<any>(endpoint);

      let schemas: any[] = [];
      if (response && Array.isArray(response.measurementSchemas)) {
        schemas = response.measurementSchemas;
      } else if (Array.isArray(response)) {
        schemas = response;
      }

      return schemas.map((schema) => {
        const schemaInfo: SchemaInfo = {
          name: schema.name,
          bucketId: schema.bucketID || bucketId!,
          bucketName: bucketName,
        };

        if (Array.isArray(schema.columns)) {
          schemaInfo.columns = schema.columns.map((col: any) => ({
            name: col.name,
            type: col.type,
            dataType: col.dataType,
          }));
        }

        if (schema.createdAt) {
          schemaInfo.createdAt = schema.createdAt;
        }
        if (schema.updatedAt) {
          schemaInfo.updatedAt = schema.updatedAt;
        }

        return schemaInfo;
      });
    } catch (error: any) {
      this.handleSchemaError(error, `list schemas for bucket '${bucketName}'`);
    }
  }

  /**
   * Get detailed information about a specific measurement schema
   * GET /api/v2/buckets/{bucketID}/schema/measurements/{measurementID}
   */
  async getSchema(bucketName: string, schemaName: string): Promise<SchemaInfo> {
    this.validateSchemaOperationSupport();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);

      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucketId: string | undefined;

      if (bucketsResponse?.buckets) {
        const bucket = bucketsResponse.buckets.find(
          (b) => b.name === bucketName && b.type !== "system",
        );
        if (bucket) {
          bucketId = bucket.id;
        }
      }

      if (!bucketId) {
        throw new Error(`Bucket '${bucketName}' not found`);
      }

      const schemasResponse = await httpClient.get<any>(
        `/api/v2/buckets/${bucketId}/schema/measurements`,
      );
      let measurementId: string | undefined;

      if (
        schemasResponse &&
        Array.isArray(schemasResponse.measurementSchemas)
      ) {
        const schema = schemasResponse.measurementSchemas.find(
          (s: any) => s.name === schemaName,
        );
        if (schema) {
          measurementId = schema.id;
        }
      }

      if (!measurementId) {
        throw new Error(
          `Schema '${schemaName}' not found in bucket '${bucketName}'`,
        );
      }

      const endpoint = `/api/v2/buckets/${bucketId}/schema/measurements/${measurementId}`;
      const response = await httpClient.get<any>(endpoint);

      const schemaInfo: SchemaInfo = {
        name: response.name,
        bucketId: response.bucketID || bucketId,
        bucketName: bucketName,
      };

      if (Array.isArray(response.columns)) {
        schemaInfo.columns = response.columns.map((col: any) => ({
          name: col.name,
          type: col.type,
          dataType: col.dataType,
        }));
      }

      if (response.createdAt) {
        schemaInfo.createdAt = response.createdAt;
      }
      if (response.updatedAt) {
        schemaInfo.updatedAt = response.updatedAt;
      }

      return schemaInfo;
    } catch (error: any) {
      this.handleSchemaError(
        error,
        `get schema '${schemaName}' from bucket '${bucketName}'`,
      );
    }
  }

  /**
   * Create a new measurement schema in a bucket
   * POST /api/v2/buckets/{bucketID}/schema/measurements
   */
  async createSchema(config: CreateSchemaConfig): Promise<boolean> {
    this.validateSchemaOperationSupport();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);

      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucketId: string | undefined;

      if (bucketsResponse?.buckets) {
        const bucket = bucketsResponse.buckets.find(
          (b) => b.name === config.bucketName && b.type !== "system",
        );
        if (bucket) {
          bucketId = bucket.id;
        }
      }

      if (!bucketId) {
        throw new Error(`Bucket '${config.bucketName}' not found`);
      }

      const payload = {
        name: config.name,
        columns: config.columns.map((col) => {
          const column: any = {
            type: col.type,
            name: col.name,
          };

          if (col.type === "field" && col.dataType) {
            column.dataType = col.dataType;
          }

          return column;
        }),
      };

      const endpoint = `/api/v2/buckets/${bucketId}/schema/measurements`;
      await httpClient.post(endpoint, payload);

      return true;
    } catch (error: any) {
      this.handleSchemaError(
        error,
        `create schema '${config.name}' in bucket '${config.bucketName}'`,
      );
    }
  }

  /**
   * Add new columns to an existing measurement schema
   * IMPORTANT: This endpoint only allows ADDING new columns, not modifying existing ones.
   * The request must include ALL columns (existing + new ones to add).
   * Get the current schema first to retrieve existing columns, then include them with new columns.
   * PATCH /api/v2/buckets/{bucketID}/schema/measurements/{measurementName}
   */
  async updateSchema(
    bucketName: string,
    schemaName: string,
    config: UpdateSchemaConfig,
  ): Promise<boolean> {
    this.validateSchemaOperationSupport();

    try {
      const httpClient = this.baseService.getInfluxHttpClient(true);

      const bucketsResponse = await httpClient.get<{ buckets?: any[] }>(
        "/api/v2/buckets",
      );
      let bucketId: string | undefined;

      if (bucketsResponse?.buckets) {
        const bucket = bucketsResponse.buckets.find(
          (b) => b.name === bucketName && b.type !== "system",
        );
        if (bucket) {
          bucketId = bucket.id;
        }
      }

      if (!bucketId) {
        throw new Error(`Bucket '${bucketName}' not found`);
      }

      const schemasResponse = await httpClient.get(
        `/api/v2/buckets/${bucketId}/schema/measurements`,
      );

      if (
        !schemasResponse.measurementSchemas ||
        !Array.isArray(schemasResponse.measurementSchemas)
      ) {
        throw new Error(`No schemas found in bucket '${bucketName}'`);
      }

      const existingSchema = schemasResponse.measurementSchemas.find(
        (schema: any) => schema.name === schemaName,
      );

      if (!existingSchema) {
        throw new Error(
          `Schema '${schemaName}' not found in bucket '${bucketName}'`,
        );
      }

      const measurementId = existingSchema.id;

      const updatePayload = {
        columns:
          config.columns?.map((col) => ({
            name: col.name,
            type: col.type,
            ...(col.type === "field" &&
              col.dataType && { dataType: col.dataType }),
          })) || [],
      };

      await httpClient.patch(
        `/api/v2/buckets/${bucketId}/schema/measurements/${measurementId}`,
        updatePayload,
      );

      return true;
    } catch (error: any) {
      if (error.response?.data) {
        throw new Error(
          `Failed to update schema: ${JSON.stringify(error.response.data, null, 2)}`,
        );
      } else {
        throw new Error(
          `Failed to update schema '${schemaName}': ${error.message}`,
        );
      }
    }
  }

  /**
   * Common error handling for schema operations
   */
  private handleSchemaError(error: any, operation: string): never {
    const status = error.response?.status;
    const originalMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.response?.statusText;

    const formatError = (userMessage: string): string => {
      const parts = [`HTTP ${status}`, userMessage];
      if (originalMessage) {
        parts.push(`Server message: ${originalMessage}`);
      }
      return parts.join(" - ");
    };

    switch (status) {
      case 400:
        throw new Error(
          formatError("Bad Request: Invalid schema definition or parameters"),
        );
      case 401:
        throw new Error(
          formatError("Unauthorized: Check your InfluxDB token permissions"),
        );
      case 403:
        throw new Error(
          formatError(
            "Forbidden: Token lacks permissions for schema operations",
          ),
        );
      case 404:
        throw new Error(
          formatError("Not Found: Schema or bucket does not exist"),
        );
      case 409:
        throw new Error(
          formatError(
            "Conflict: Schema already exists or conflicts with bucket settings",
          ),
        );
      default:
        throw new Error(`Failed to ${operation}: ${error.message}`);
    }
  }
}
