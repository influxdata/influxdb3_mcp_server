/**
 * Cloud Token Management Tools (Cloud-Dedicated/Clustered)
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";

export function createCloudTokenTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "cloud_list_database_tokens",
      description:
        "List all database tokens for InfluxDB Cloud-Dedicated/Clustered cluster. Returns token information including permissions and creation dates.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      zodSchema: z.object({}),
      handler: async () => {
        try {
          const cloudTokenService =
            influxService.getCloudTokenManagementService();
          const tokens = await cloudTokenService.listTokens();

          const tokenCount = tokens.length;
          const tokenList = tokens
            .map(
              (token) =>
                `• ${token.description} (ID: ${token.id})\n  Permissions: ${token.permissions.length > 0 ? token.permissions.map((p) => `${p.action}:${p.resource}`).join(", ") : "No access"}\n  Created: ${token.createdAt}`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Found ${tokenCount} database token${tokenCount !== 1 ? "s" : ""} in Cloud-Dedicated/Clustered cluster:\n\n${tokenList || "None"}\n\nFull details:\n${JSON.stringify(tokens, null, 2)}`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "cloud_get_database_token",
      description:
        "Get details of a specific database token by ID for InfluxDB Cloud-Dedicated/Clustered cluster.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: {
            type: "string",
            description: "The ID of the token to retrieve",
          },
        },
        required: ["token_id"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        token_id: z.string().describe("The ID of the token to retrieve"),
      }),
      handler: async (args) => {
        try {
          const cloudTokenService =
            influxService.getCloudTokenManagementService();
          const token = await cloudTokenService.getToken(args.token_id);

          const permissionsList =
            token.permissions.length > 0
              ? token.permissions
                  .map((p) => `${p.action}:${p.resource}`)
                  .join(", ")
              : "No access";

          return {
            content: [
              {
                type: "text",
                text: `Database Token Details:\n\nDescription: ${token.description}\nID: ${token.id}\nPermissions: ${permissionsList}\nCreated: ${token.createdAt}\nAccount ID: ${token.accountId}\nCluster ID: ${token.clusterId}\n\nFull details:\n${JSON.stringify(token, null, 2)}`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "cloud_create_database_token",
      description:
        'Create a new database token for InfluxDB Cloud-Dedicated/Clustered cluster. Specify exact permissions per database or create a no-access token.\n\nPermissions format: [{"database": "db_name", "action": "read|write"}, ...]\nExamples:\n• No access: omit permissions field or use []\n• Read-only on \'analytics\': [{"database": "analytics", "action": "read"}]\n• Mixed permissions: [{"database": "logs", "action": "read"}, {"database": "metrics", "action": "write"}]\n• Full access: [{"database": "*", "action": "read"}, {"database": "*", "action": "write"}]',
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Description/name for the token",
          },
          permissions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                database: {
                  type: "string",
                  description: "Database name or '*' for all databases",
                },
                action: {
                  type: "string",
                  enum: ["read", "write"],
                  description: "Permission level for this database",
                },
              },
              required: ["database", "action"],
              additionalProperties: false,
            },
            description:
              "Array of permission objects. Each object specifies database and action. Leave empty array [] for no-access token.",
          },
        },
        required: ["description"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        description: z.string().describe("Description/name for the token"),
        permissions: z
          .array(
            z.object({
              database: z
                .string()
                .describe("Database name or '*' for all databases"),
              action: z
                .enum(["read", "write"])
                .describe("Permission level for this database"),
            }),
          )
          .optional()
          .describe(
            "Array of permission objects. Omit or use empty array for no-access token",
          ),
      }),
      handler: async (args) => {
        try {
          const cloudTokenService =
            influxService.getCloudTokenManagementService();

          const permissions = (args.permissions || []).map((p: any) => ({
            action: p.action,
            resource: p.database,
          }));

          const result = await cloudTokenService.createToken({
            description: args.description,
            permissions,
          });

          const permissionsList =
            result.permissions.length > 0
              ? result.permissions
                  .map((p) => `${p.action}:${p.resource}`)
                  .join(", ")
              : "No access";

          return {
            content: [
              {
                type: "text",
                text: `Database token created successfully!\n\nDescription: ${result.description}\nToken ID: ${result.id}\nPermissions: ${permissionsList}\nAccess Token: ${result.accessToken}\n\n⚠️ Store this access token securely - it won't be shown again!`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "cloud_update_database_token",
      description:
        'Update an existing database token for InfluxDB Cloud-Dedicated/Clustered cluster. Can update description and/or permissions with precise control.\n\nPermissions format: [{"database": "db_name", "action": "read|write"}, ...]\nNote: Permissions completely replace existing ones - include all desired permissions.\nExamples:\n• No access: use []\n• Read-only on \'analytics\': [{"database": "analytics", "action": "read"}]\n• Mixed permissions: [{"database": "logs", "action": "read"}, {"database": "metrics", "action": "write"}]\n• Full access: [{"database": "*", "action": "read"}, {"database": "*", "action": "write"}]',
      inputSchema: {
        type: "object",
        properties: {
          token_id: {
            type: "string",
            description: "The ID of the token to update",
          },
          description: {
            type: "string",
            description: "New description for the token (optional)",
          },
          permissions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                database: {
                  type: "string",
                  description: "Database name or '*' for all databases",
                },
                action: {
                  type: "string",
                  enum: ["read", "write"],
                  description: "Permission level for this database",
                },
              },
              required: ["database", "action"],
              additionalProperties: false,
            },
            description:
              "Array of permission objects. Each object specifies database and action. Use empty array [] for no-access token.",
          },
        },
        required: ["token_id"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        token_id: z.string().describe("The ID of the token to update"),
        description: z
          .string()
          .optional()
          .describe("New description for the token"),
        permissions: z
          .array(
            z.object({
              database: z
                .string()
                .describe("Database name or '*' for all databases"),
              action: z
                .enum(["read", "write"])
                .describe("Permission level for this database"),
            }),
          )
          .optional()
          .describe(
            "Array of permission objects. Use empty array for no-access token",
          ),
      }),
      handler: async (args) => {
        try {
          const cloudTokenService =
            influxService.getCloudTokenManagementService();

          const updateRequest: any = {};

          if (args.description !== undefined) {
            updateRequest.description = args.description;
          }

          if (args.permissions !== undefined) {
            updateRequest.permissions = args.permissions.map((p: any) => ({
              action: p.action,
              resource: p.database,
            }));
          }

          const result = await cloudTokenService.updateToken(
            args.token_id,
            updateRequest,
          );

          const permissionsList =
            result.permissions.length > 0
              ? result.permissions
                  .map((p) => `${p.action}:${p.resource}`)
                  .join(", ")
              : "No access";

          return {
            content: [
              {
                type: "text",
                text: `Database token updated successfully!\n\nDescription: ${result.description}\nToken ID: ${result.id}\nPermissions: ${permissionsList}\nCreated: ${result.createdAt}`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "cloud_delete_database_token",
      description:
        "Delete a database token from InfluxDB Cloud-Dedicated/Clustered cluster. This action cannot be undone.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: {
            type: "string",
            description: "The ID of the token to delete",
          },
        },
        required: ["token_id"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        token_id: z.string().describe("The ID of the token to delete"),
      }),
      handler: async (args) => {
        try {
          const cloudTokenService =
            influxService.getCloudTokenManagementService();
          await cloudTokenService.deleteToken(args.token_id);

          return {
            content: [
              {
                type: "text",
                text: `Database token '${args.token_id}' deleted successfully.`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  ];
}
