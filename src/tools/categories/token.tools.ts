/**
 * Token Management Tools (Core/Enterprise)
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { InfluxProductType } from "../../helpers/enums/influx-product-types.enum.js";
import { McpTool } from "../index.js";

export function createTokenTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "create_admin_token",
      description:
        "Create a new InfluxDB named admin token with full administrative permissions (Core/Enterprise only). Named admin tokens can manage databases, users, and resource tokens, but cannot manage other admin tokens.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              'Optional name for the admin token (e.g., "backup-admin-token"). If not provided, a unique name will be generated.',
          },
          expiry_secs: {
            type: "number",
            description:
              "Optional expiration time in seconds. If omitted, the token doesn't expire.",
            minimum: 1,
          },
        },
        additionalProperties: false,
      },
      zodSchema: z.object({
        name: z
          .string()
          .optional()
          .describe("Optional name for the admin token"),
        expiry_secs: z
          .number()
          .min(1)
          .optional()
          .describe("Optional expiration time in seconds"),
      }),
      handler: async (args) => {
        try {
          const tokenService = influxService.getTokenManagementService();
          const result = await tokenService.createAdminToken(
            args.name,
            args.expiry_secs,
          );
          return {
            content: [
              {
                type: "text",
                text: `Admin token created successfully:\nToken ID: ${result.id}\nToken: ${result.token}\n\n⚠️ Store this token securely - it won't be shown again!`,
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
      name: "list_admin_tokens",
      description:
        "List all admin tokens (operator and named admin tokens) with optional filtering by token name (Core/Enterprise only). Named admin tokens have full administrative access including resource token management.",
      inputSchema: {
        type: "object",
        properties: {
          tokenName: {
            type: "string",
            description:
              "Optional filter to search for tokens with names containing this text (case-insensitive partial match)",
          },
        },
        additionalProperties: false,
      },
      zodSchema: z.object({
        tokenName: z
          .string()
          .optional()
          .describe("Optional filter for token name (partial match)"),
      }),
      handler: async (args) => {
        try {
          const tokenService = influxService.getTokenManagementService();
          const filters: any = {};

          if (args.tokenName) {
            filters.tokenName = args.tokenName;
          }

          const result = await tokenService.listAdminTokens(
            Object.keys(filters).length > 0 ? filters : undefined,
          );

          const resultText = `Admin tokens retrieved successfully:\n${JSON.stringify(result, null, 2)}`;

          return {
            content: [
              {
                type: "text",
                text: resultText,
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
      name: "list_resource_tokens",
      description:
        "List all Enterprise resource tokens with optional filtering by database name and/or token name, and ordering.",
      inputSchema: {
        type: "object",
        properties: {
          databaseName: {
            type: "string",
            description:
              "Optional filter to show only tokens that have access to this database (partial match)",
          },
          tokenName: {
            type: "string",
            description:
              "Optional filter to search for tokens with names containing this text (case-insensitive partial match)",
          },
          orderBy: {
            type: "string",
            enum: ["created_at", "token_id", "name"],
            description: "Optional field to order results by",
          },
          orderDirection: {
            type: "string",
            enum: ["ASC", "DESC"],
            description:
              "Optional direction for ordering (ASC or DESC). Defaults to ASC.",
            default: "ASC",
          },
        },
        additionalProperties: false,
      },
      zodSchema: z.object({
        databaseName: z
          .string()
          .optional()
          .describe("Optional filter for database name (partial match)"),
        tokenName: z
          .string()
          .optional()
          .describe("Optional filter for token name (partial match)"),
        orderBy: z
          .enum(["created_at", "token_id", "name"])
          .optional()
          .describe("Field to order results by"),
        orderDirection: z
          .enum(["ASC", "DESC"])
          .optional()
          .default("ASC")
          .describe("Ordering direction"),
      }),
      handler: async (args) => {
        try {
          const tokenService = influxService.getTokenManagementService();
          const filters: any = {};

          if (args.databaseName) {
            filters.databaseName = args.databaseName;
          }

          if (args.tokenName) {
            filters.tokenName = args.tokenName;
          }

          if (args.orderBy) {
            filters.order = {
              field: args.orderBy,
              direction: args.orderDirection || "ASC",
            };
          }

          const result = await tokenService.listResourceTokens(
            Object.keys(filters).length > 0 ? filters : undefined,
          );

          const resultText = `Resource tokens retrieved successfully:\n${JSON.stringify(result, null, 2)}`;

          return {
            content: [
              {
                type: "text",
                text: resultText,
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
      name: "regenerate_operator_token",
      description:
        "Regenerate the InfluxDB operator token (Core/Enterprise only). Returns the new token value. ⚠️ This action invalidates current operator token and is irreversible. Receive the explicit user confirmation before proceeding.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      zodSchema: z.object({}),
      handler: async () => {
        try {
          const tokenService = influxService.getTokenManagementService();
          const result = await tokenService.regenerateOperatorToken();
          return {
            content: [
              {
                type: "text",
                text: `Operator token regenerated successfully:\nToken ID: ${result.id}\nToken: ${result.token}\n\n⚠️ Store this token securely - it won't be shown again!\n⚠️ The old operator token is now invalid.`,
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
      name: "create_resource_token",
      description:
        'Create a new InfluxDB Enterprise resource token with specific database permissions. Example: databases=["mydb", "testdb"], actions=["read", "write"]',
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description:
              'Description/name for the resource token (e.g., "My App Token")',
          },
          databases: {
            type: "array",
            items: { type: "string" },
            description:
              'Array of database names this token can access. Example: ["database1", "database2"]. Use exact database names from your InfluxDB instance.',
            minItems: 1,
          },
          actions: {
            type: "array",
            items: { type: "string", enum: ["read", "write"] },
            description:
              'Array of permissions for the databases. Example: ["read"] for read-only, ["read", "write"] for full access, or ["write"] for write-only.',
            minItems: 1,
          },
          expiry_secs: {
            type: "number",
            description:
              "Optional expiration time in seconds (e.g., 3600 for 1 hour, 86400 for 1 day, 604800 for 1 week). If not specified, token never expires.",
            minimum: 1,
          },
        },
        required: ["description", "databases", "actions"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        description: z
          .string()
          .describe(
            'Description/name for the resource token (e.g., "My App Token")',
          ),
        databases: z
          .array(z.string())
          .min(1)
          .describe(
            'Array of database names this token can access. Example: ["database1", "database2"]',
          ),
        actions: z
          .array(z.enum(["read", "write"]))
          .min(1)
          .describe(
            'Array of permissions: ["read"], ["write"], or ["read", "write"]',
          ),
        expiry_secs: z
          .number()
          .min(1)
          .optional()
          .describe(
            "Optional expiration time in seconds (e.g., 3600, 86400, 604800)",
          ),
      }),
      handler: async (args) => {
        try {
          const tokenService = influxService.getTokenManagementService();

          const permissions = [
            {
              resource_type: "db" as const,
              resource_names: args.databases,
              actions: args.actions as ("read" | "write")[],
            },
          ];

          const expiry_secs = args.expiry_secs;

          const result = await tokenService.createResourceToken(
            args.description,
            permissions,
            expiry_secs,
          );

          let expiryInfo = "\nExpires: Never";
          if (args.expiry_secs) {
            const hours = Math.floor(args.expiry_secs / 3600);
            const days = Math.floor(hours / 24);
            if (days > 0) {
              expiryInfo = `\nExpires: In ${days} day${days !== 1 ? "s" : ""} (${args.expiry_secs} seconds)`;
            } else if (hours > 0) {
              expiryInfo = `\nExpires: In ${hours} hour${hours !== 1 ? "s" : ""} (${args.expiry_secs} seconds)`;
            } else {
              expiryInfo = `\nExpires: In ${args.expiry_secs} seconds`;
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `Resource token created successfully:\nToken ID: ${result.id}\nToken: ${result.token}\nDatabases: ${args.databases.join(", ")}\nActions: ${args.actions.join(", ")}${expiryInfo}\n\n⚠️ Store this token securely - it won't be shown again!`,
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
      name: "delete_token",
      description: "Delete an InfluxDB token by name (Core/Enterprise only).",
      inputSchema: {
        type: "object",
        properties: {
          token_name: {
            type: "string",
            description: "Name of the token to delete (required)",
          },
        },
        required: ["token_name"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        token_name: z.string().describe("Name of the token to delete"),
      }),
      handler: async (args) => {
        try {
          const tokenService = influxService.getTokenManagementService();
          const result = await tokenService.deleteToken(args.token_name);
          if (result) {
            return {
              content: [
                {
                  type: "text",
                  text: `Token '${args.token_name}' deleted successfully.`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to delete token '${args.token_name}'.`,
                },
              ],
              isError: true,
            };
          }
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

  if (influxService.getConfig().influx.type === InfluxProductType.Core) {
    return tools.filter(
      (tool) =>
        tool.name !== "list_resource_tokens" &&
        tool.name !== "create_resource_token",
    );
  }

  return tools;
}
