/**
 * Schema Management Tools for InfluxDB Cloud Serverless
 *
 * Provides tools for managing measurement schemas in Cloud Serverless buckets.
 * These tools are only available for Cloud Serverless instances with explicit schema type.
 * Explicit schema type is not implemented in v3 InfluxDB cloud serverless as of now.
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";

export function createSchemaTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "serverless_list_schemas",
      description:
        "List all measurement schemas in a Cloud Serverless bucket. Only available for buckets with explicit schema type. Shows schema names, column definitions, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          bucketName: {
            type: "string",
            description: "Name of the bucket to list schemas from",
          },
        },
        required: ["bucketName"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        bucketName: z
          .string()
          .describe("Name of the bucket to list schemas from"),
      }),
      handler: async (args) => {
        try {
          const schemas = await influxService.schema.listSchemas(
            args.bucketName,
          );

          const schemaList = schemas.map((schema) => schema.name).join(", ");
          const count = schemas.length;

          return {
            content: [
              {
                type: "text",
                text: `Found ${count} schema${count !== 1 ? "s" : ""} in bucket '${args.bucketName}':\n${schemaList || "None"}\n\nSchema details:\n${JSON.stringify(schemas, null, 2)}`,
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
      name: "serverless_get_schema",
      description:
        "Get detailed information about a specific measurement schema in a Cloud Serverless bucket. Shows column definitions, data types, and schema metadata.",
      inputSchema: {
        type: "object",
        properties: {
          bucketName: {
            type: "string",
            description: "Name of the bucket containing the schema",
          },
          schemaName: {
            type: "string",
            description: "Name of the measurement schema to retrieve",
          },
        },
        required: ["bucketName", "schemaName"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        bucketName: z
          .string()
          .describe("Name of the bucket containing the schema"),
        schemaName: z
          .string()
          .describe("Name of the measurement schema to retrieve"),
      }),
      handler: async (args) => {
        try {
          const schema = await influxService.schema.getSchema(
            args.bucketName,
            args.schemaName,
          );

          return {
            content: [
              {
                type: "text",
                text: `Schema '${args.schemaName}' details:\n\n${JSON.stringify(schema, null, 2)}`,
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
      name: "serverless_create_schema",
      description:
        "Create a new measurement schema in a Cloud Serverless bucket with explicit schema type. Define columns with their types (tag, field, timestamp) and data types.",
      inputSchema: {
        type: "object",
        properties: {
          bucketName: {
            type: "string",
            description: "Name of the bucket to create the schema in",
          },
          schemaName: {
            type: "string",
            description: "Name of the measurement schema to create",
          },
          columns: {
            type: "array",
            description: "Array of column definitions for the schema",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Column name",
                },
                type: {
                  type: "string",
                  enum: ["tag", "field", "timestamp"],
                  description:
                    "Column type: tag (indexed metadata), field (actual data), or timestamp",
                },
                dataType: {
                  type: "string",
                  enum: ["string", "float", "integer", "boolean", "time"],
                  description:
                    "Data type for the column (required for field columns, optional for others)",
                },
              },
              required: ["name", "type"],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ["bucketName", "schemaName", "columns"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        bucketName: z
          .string()
          .describe("Name of the bucket to create the schema in"),
        schemaName: z
          .string()
          .describe("Name of the measurement schema to create"),
        columns: z
          .array(
            z.object({
              name: z.string().describe("Column name"),
              type: z
                .enum(["tag", "field", "timestamp"])
                .describe("Column type"),
              dataType: z
                .enum(["string", "float", "integer", "boolean", "time"])
                .optional()
                .describe("Data type for the column"),
            }),
          )
          .min(1)
          .describe("Array of column definitions"),
      }),
      handler: async (args) => {
        try {
          const config = {
            name: args.schemaName,
            bucketName: args.bucketName,
            columns: args.columns,
          };

          await influxService.schema.createSchema(config);

          return {
            content: [
              {
                type: "text",
                text: `Schema '${args.schemaName}' created successfully in bucket '${args.bucketName}'`,
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
      name: "serverless_update_schema",
      description:
        "Add new columns to an existing measurement schema in a Cloud Serverless bucket. IMPORTANT: You can only ADD new columns, not modify existing ones. The endpoint requires ALL columns (existing + new) to be sent. Use get_schema first to retrieve current columns, then include them along with new columns in this update.",
      inputSchema: {
        type: "object",
        properties: {
          bucketName: {
            type: "string",
            description: "Name of the bucket containing the schema",
          },
          schemaName: {
            type: "string",
            description: "Current name of the measurement schema to update",
          },
          columns: {
            type: "array",
            description:
              "Complete array of ALL column definitions (existing columns + new columns to add). Must include all current columns plus any new ones you want to add.",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Column name",
                },
                type: {
                  type: "string",
                  enum: ["tag", "field", "timestamp"],
                  description:
                    "Column type: tag (indexed metadata), field (actual data), or timestamp",
                },
                dataType: {
                  type: "string",
                  enum: ["string", "float", "integer", "boolean", "time"],
                  description: "Data type for the column",
                },
              },
              required: ["name", "type"],
              additionalProperties: false,
            },
          },
        },
        required: ["bucketName", "schemaName"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        bucketName: z
          .string()
          .describe("Name of the bucket containing the schema"),
        schemaName: z
          .string()
          .describe("Current name of the measurement schema to update"),
        columns: z
          .array(
            z.object({
              name: z.string().describe("Column name"),
              type: z
                .enum(["tag", "field", "timestamp"])
                .describe("Column type"),
              dataType: z
                .enum(["string", "float", "integer", "boolean", "time"])
                .optional()
                .describe("Data type for the column"),
            }),
          )
          .optional()
          .describe("Updated array of column definitions"),
      }),
      handler: async (args) => {
        try {
          const success = await influxService.schema.updateSchema(
            args.bucketName,
            args.schemaName,
            {
              columns: args.columns,
            },
          );

          if (success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Schema '${args.schemaName}' updated successfully. New columns have been added to the existing schema.`,
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to update schema '${args.schemaName}'.`,
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
}
