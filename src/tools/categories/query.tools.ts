/**
 * Query and Schema Tools
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";
import { errorResponse, okResponse } from "../response.js";

const queryFormatSchema = z
  .enum(["json", "jsonl", "csv", "pretty", "parquet"])
  .optional()
  .default("json");

const queryFormatInputSchema = {
  type: "string",
  enum: ["json", "jsonl", "csv", "pretty", "parquet"],
  description: "Output format for query results",
  default: "json",
};

function readOnlyQueryInputSchema(queryDescription: string) {
  return {
    type: "object",
    properties: {
      db: {
        type: "string",
        description: "Database name to query",
      },
      q: {
        type: "string",
        description: queryDescription,
      },
      params: {
        description: "Optional query parameters to pass through",
      },
      format: queryFormatInputSchema,
      maxRows: {
        type: "number",
        description: "Maximum rows to return. Default 1000; hard max 5000.",
        minimum: 1,
        maximum: 5000,
      },
      timeoutMs: {
        type: "number",
        description: "Optional query timeout in milliseconds",
        minimum: 1,
      },
    },
    required: ["db", "q"],
    additionalProperties: false,
  };
}

const readOnlyQueryZodSchema = z.object({
  db: z.string().describe("Database name to query"),
  q: z.string().describe("Read-only query to run"),
  params: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
  format: queryFormatSchema,
  maxRows: z.number().int().min(1).max(5000).optional(),
  timeoutMs: z.number().int().min(1).optional(),
});

export function createQueryTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "query_sql",
      description:
        "Run one bounded, read-only SQL query against an InfluxDB 3 database. Defaults to JSON output and returns structured rows, warnings, and query metadata.",
      inputSchema: readOnlyQueryInputSchema("Read-only SQL query to run"),
      zodSchema: readOnlyQueryZodSchema,
      handler: async (args) => {
        try {
          const result = await influxService.query.querySqlReadOnly(
            args.q,
            args.db,
            {
              format: args.format,
              maxRows: args.maxRows,
              params: args.params,
              timeoutMs: args.timeoutMs,
            },
          );
          return okResponse(result);
        } catch (error: any) {
          return errorResponse(error, error.code || "query_sql_failed");
        }
      },
    },

    {
      name: "query_influxql",
      description:
        "Run one bounded, read-only InfluxQL query against an InfluxDB 3 database. Rejects SELECT INTO and destructive statements.",
      inputSchema: readOnlyQueryInputSchema("Read-only InfluxQL query to run"),
      zodSchema: readOnlyQueryZodSchema,
      handler: async (args) => {
        try {
          const result = await influxService.query.queryInfluxqlReadOnly(
            args.q,
            args.db,
            {
              format: args.format,
              maxRows: args.maxRows,
              params: args.params,
              timeoutMs: args.timeoutMs,
            },
          );
          return okResponse(result);
        } catch (error: any) {
          return errorResponse(error, error.code || "query_influxql_failed");
        }
      },
    },

    {
      name: "list_tables",
      description:
        "List tables, also called measurements, in an InfluxDB database.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description: "Database name to inspect",
          },
        },
        required: ["db"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        db: z.string().describe("Database name to inspect"),
      }),
      handler: async (args) => {
        try {
          const tables = await influxService.query.getMeasurements(args.db);
          return okResponse({
            ok: true,
            db: args.db,
            tables,
            table_count: tables.length,
            warnings: [],
          });
        } catch (error: any) {
          return errorResponse(error, "list_tables_failed");
        }
      },
    },

    {
      name: "describe_table",
      description:
        "Describe table schema using InfluxDB metadata. Unknown tag/field roles are returned as category=unknown instead of guessed.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description: "Database name containing the table",
          },
          table: {
            type: "string",
            description: "Table or measurement name to describe",
          },
        },
        required: ["db", "table"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        db: z.string().describe("Database name containing the table"),
        table: z.string().describe("Table or measurement name to describe"),
      }),
      handler: async (args) => {
        try {
          const schema = await influxService.query.getMeasurementSchema(
            args.table,
            args.db,
          );
          return okResponse({
            ok: true,
            db: args.db,
            table: args.table,
            ...schema,
            warnings: schema.columns
              .filter((column) => column.category === "unknown")
              .map((column) => ({
                code: "unknown_column_category",
                message: `Column '${column.name}' has unknown tag/field category.`,
              })),
          });
        } catch (error: any) {
          return errorResponse(error, "describe_table_failed");
        }
      },
    },

    {
      name: "investigate_database",
      description:
        "Discover tables and schemas in a database, optionally sampling recent rows from each table with bounded reads.",
      inputSchema: {
        type: "object",
        properties: {
          db: {
            type: "string",
            description: "Database name to investigate",
          },
          includeSamples: {
            type: "boolean",
            description: "Whether to include recent sample rows",
            default: false,
          },
          maxTables: {
            type: "number",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
          sampleRowsPerTable: {
            type: "number",
            minimum: 1,
            maximum: 20,
            default: 3,
          },
        },
        required: ["db"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        db: z.string().describe("Database name to investigate"),
        includeSamples: z.boolean().optional().default(false),
        includeCardinality: z.boolean().optional().default(false),
        maxTables: z.number().int().min(1).max(100).optional().default(20),
        sampleRowsPerTable: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(3),
      }),
      handler: async (args) => {
        try {
          const tables = (
            await influxService.query.getMeasurements(args.db)
          ).slice(0, args.maxTables);
          const tableDetails = [];

          for (const table of tables) {
            const schema = await influxService.query.getMeasurementSchema(
              table.name,
              args.db,
            );
            let samples: any[] | undefined;
            if (args.includeSamples) {
              const sample = await influxService.query.querySqlReadOnly(
                `SELECT * FROM "${table.name}"`,
                args.db,
                {
                  maxRows: args.sampleRowsPerTable,
                },
              );
              samples = sample.rows;
            }

            tableDetails.push({
              name: table.name,
              schema,
              ...(samples !== undefined && { samples }),
            });
          }

          return okResponse({
            ok: true,
            db: args.db,
            table_count: tableDetails.length,
            tables: tableDetails,
            warnings: tableDetails.flatMap((detail) =>
              detail.schema.columns
                .filter((column) => column.category === "unknown")
                .map((column) => ({
                  code: "unknown_column_category",
                  message: `Table '${detail.name}' column '${column.name}' has unknown tag/field category.`,
                })),
            ),
          });
        } catch (error: any) {
          return errorResponse(error, "investigate_database_failed");
        }
      },
    },

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
