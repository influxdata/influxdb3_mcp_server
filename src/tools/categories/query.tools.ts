/**
 * Query and Schema Tools
 */

import {
  investigateDatabase,
  tableMetadata,
  schemaMetadata,
} from "../../services/investigation.service.js";
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
  description:
    "Output format for query results. Core and Enterprise return json, jsonl, or csv; Cloud Dedicated, Cloud Serverless, and Clustered return json. Other formats are refused with unsupported_query_format.",
  default: "json",
};

function readOnlyQueryInputSchema(queryDescription: string) {
  return {
    type: "object",
    properties: {
      db: {
        type: "string",
        description:
          "Database name to query. Canonical name; database is an alias.",
      },
      q: {
        type: "string",
        description: queryDescription,
      },
      database: {
        type: "string",
        description: "Alias for db; provide one or equal values.",
      },
      query: {
        type: "string",
        description: "Alias for q; provide one or equal values.",
      },
      params: {
        anyOf: [{ type: "object" }, { type: "array" }],
        description: "Optional query parameters to pass through",
      },
      format: queryFormatInputSchema,
      maxRows: {
        type: "integer",
        description: "Maximum rows to return. Default 1000; hard max 5000.",
        minimum: 1,
        maximum: 5000,
      },
      timeoutMs: {
        type: "integer",
        description: "Optional query timeout in milliseconds",
        minimum: 1,
      },
    },
    required: [],
    additionalProperties: false,
  };
}

const readOnlyQueryZodSchema = z
  .object({
    db: z.string().optional(),
    database: z.string().optional(),
    q: z.string().optional(),
    query: z.string().optional(),
    params: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
    format: queryFormatSchema,
    maxRows: z.number().int().min(1).max(5000).optional(),
    timeoutMs: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    for (const [canonical, alias] of [
      ["db", "database"],
      ["q", "query"],
    ] as const) {
      if (args[canonical] === undefined && args[alias] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [canonical],
          message: `Provide ${canonical} or ${alias}.`,
        });
      } else if (
        args[canonical] !== undefined &&
        args[alias] !== undefined &&
        args[canonical] !== args[alias]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [canonical],
          message: `${canonical} and ${alias} must agree.`,
        });
      }
    }
  })
  .transform((args) => ({
    ...args,
    db: args.db ?? args.database,
    q: args.q ?? args.query,
  }));

export function createQueryTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "query_sql",
      description:
        "Run one bounded, read-only SQL query against an InfluxDB 3 database. Accepts database as an alias for db and query as an alias for q; differing pairs are rejected. Defaults to JSON output and returns structured rows, warnings, and query metadata. Core and Enterprise also return jsonl or csv; Cloud Dedicated, Cloud Serverless, and Clustered return only JSON. Your answer must report metadata.completeness, the cap when capped, warnings, and row_count; see READING QUERY RESULTS in get_help. In SQL, quoted identifiers are exact column names; if a quoted selector contains *, treat it as wildcard intent, call describe_table, expand matching fields explicitly, then retry one bounded query_sql. Use query_influxql regex only when the user explicitly asks for InfluxQL or regex field selection.",
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
        "Run one bounded, read-only InfluxQL query against an InfluxDB 3 database. Accepts database as an alias for db and query as an alias for q; differing pairs are rejected. Defaults to JSON output and returns structured rows, warnings, and query metadata. Core and Enterprise also return jsonl or csv; Cloud Dedicated, Cloud Serverless, and Clustered return only JSON. Your answer must report metadata.completeness, the cap when capped, warnings, and row_count; see READING QUERY RESULTS in get_help. Rejects SELECT INTO and destructive statements. Prefer query_sql for SQL prompts; use InfluxQL regex field selection only when the user explicitly asks for InfluxQL or regex field matching. For regex field selection, write SELECT /pattern/ FROM m; a type suffix such as /pattern/::field fails to parse.",
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
            access_outcome: tables.length ? "data" : "empty",
            tables: tables.map((table) => ({
              ...table,
              ...tableMetadata(table.name),
            })),
            table_count: tables.length,
            warnings: tables.flatMap(
              (table) => tableMetadata(table.name).warnings,
            ),
          });
        } catch (error: any) {
          return errorResponse(error, "list_tables_failed");
        }
      },
    },

    {
      name: "describe_table",
      description:
        "Describe table schema using InfluxDB metadata. Unknown tag/field roles are returned as category=unknown instead of guessed. Use this before retrying SQL queries that fail on quoted wildcard or unknown-field selectors; expand matching fields explicitly and run one bounded query_sql.",
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
            access_outcome: schema.columns.length
              ? "data"
              : "metadata_unavailable",
            ...schemaMetadata(schema, args.table),
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
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
          sampleWindowHours: {
            type: "integer",
            minimum: 1,
            maximum: 8760,
            default: 24,
            description: "Look back this many hours from investigation start.",
          },
          sampleRowsPerTable: {
            type: "integer",
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
        sampleWindowHours: z
          .number()
          .int()
          .min(1)
          .max(8760)
          .optional()
          .default(24),
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
          return okResponse(
            await investigateDatabase(influxService.query, args),
          );
        } catch (error: any) {
          return errorResponse(error, "investigate_database_failed");
        }
      },
    },

    {
      name: "execute_query",
      description: `Execute a SQL query against an InfluxDB database (all versions). Returns results in the specified format (defaults to JSON). On Cloud Dedicated, Cloud Serverless, and Clustered, this tool supports only JSON output.

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
            description:
              "Output format for query results. On Cloud Dedicated, Cloud Serverless, and Clustered, this tool supports only JSON.",
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
