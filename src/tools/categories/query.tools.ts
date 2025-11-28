/**
 * Query and Schema Tools
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";

export function createQueryTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "execute_query",
      description: `Execute a SQL query against an InfluxDB database (all versions). Returns results in the specified format (defaults to JSON).

Large Dataset Warning: InfluxDB might contain massive time-series data. Always use COUNT(*) first to check size, then LIMIT/OFFSET for large results (>1000 rows).

Cloud Dedicated/Clustered & Cloud Serverless (v3) Requirements:
- GROUP BY: Include all group columns in SELECT (e.g., SELECT place, COUNT(*) ... GROUP BY place)
- Aggregations: Cast and alias COUNT (e.g., CAST(COUNT(*) AS DOUBLE) AS count)
- Note: Both products require CAST for all aggregation functions (COUNT, SUM, AVG, MIN, MAX) to ensure results appear properly in response`,
      inputSchema: {
        type: "object",
        properties: {
          database: {
            type: "string",
            description: "Name of the database/bucket to query",
          },
          query: {
            type: "string",
            description: "SQL query to execute.",
          },
          format: {
            type: "string",
            enum: ["json", "csv", "parquet", "jsonl", "pretty"],
            description: "Output format for query results",
            default: "json",
          },
        },
        required: ["database", "query"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        database: z.string().describe("Name of the database/bucket to query"),
        query: z.string().describe("SQL query to execute"),
        format: z
          .enum(["json", "csv", "parquet", "jsonl", "pretty"])
          .optional()
          .default("json"),
      }),
      handler: async (args) => {
        try {
          const result = await influxService.query.executeQuery(
            args.query,
            args.database,
            {
              format: args.format,
            },
          );
          let resultText = "";
          if (args.format === "json") {
            resultText = `Query executed successfully:\n${JSON.stringify(result, null, 2)}`;
          } else {
            resultText = `Query executed successfully (${args.format} format):\n${result}`;
          }
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
      name: "get_measurements",
      description:
        "Get a list of all measurements (tables) in a database/bucket (all versions). Uses the InfluxDB information_schema.columns to discover tables.",
      inputSchema: {
        type: "object",
        properties: {
          database: {
            type: "string",
            description:
              "Name of the database/bucket to list measurements from",
          },
        },
        required: ["database"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        database: z
          .string()
          .describe("Name of the database/bucket to list measurements from"),
      }),
      handler: async (args) => {
        try {
          const measurements = await influxService.query.getMeasurements(
            args.database,
          );

          const measurementList = measurements.map((m) => m.name).join(", ");
          const count = measurements.length;

          return {
            content: [
              {
                type: "text",
                text: `Found ${count} measurement${count !== 1 ? "s" : ""} in database '${args.database}':\n${measurementList || "None"}`,
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
      name: "get_measurement_schema",
      description:
        "Get the schema (column information) for a specific measurement/table (all versions). Shows column names, types, and categories (time/tag/field).",
      inputSchema: {
        type: "object",
        properties: {
          database: {
            type: "string",
            description:
              "Name of the database/bucket containing the measurement",
          },
          measurement: {
            type: "string",
            description: "Name of the measurement to describe",
          },
        },
        required: ["database", "measurement"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        database: z
          .string()
          .describe("Name of the database/bucket containing the measurement"),
        measurement: z.string().describe("Name of the measurement to describe"),
      }),
      handler: async (args) => {
        try {
          const schema = await influxService.query.getMeasurementSchema(
            args.measurement,
            args.database,
          );

          const columnInfo = schema.columns
            .map((col) => `  - ${col.name}: ${col.type} (${col.category})`)
            .join("\n");
          const count = schema.columns.length;

          return {
            content: [
              {
                type: "text",
                text: `Schema for measurement '${args.measurement}' in database '${args.database}':\n${count} column${count !== 1 ? "s" : ""}:\n${columnInfo}`,
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
