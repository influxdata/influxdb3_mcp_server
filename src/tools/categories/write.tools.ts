/**
 * Data Writing Tools
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";

export function createWriteTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "write_line_protocol",
      description: `Write data to InfluxDB using line protocol format (all versions). Supports single records or batches.

Line Protocol Syntax:
measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp

Components:
- measurement: table/measurement name (required)
- tags: indexed metadata (optional) - comma-separated key=value pairs
- fields: actual data (required) - space-separated from tags, comma-separated key=value pairs  
- timestamp: optional timestamp (precision must be specified in tool parameters)

Field Value Types:
- Strings: "quoted string"
- Floats: 123.45
- Integers: 123i (note the 'i' suffix)
- Booleans: t or f

Examples:
Single record: temperature,location=office,building=main value=23.5,humidity=45i 1640995200
Batch (separate with newlines):
temperature,location=office value=23.5 1640995200
humidity,location=office value=45i 1640995201

Important: Always specify correct precision parameter to match your timestamp format. Use any precision if writing data with no timestamp. Escaping required for special characters in tags/fields.`,
      inputSchema: {
        type: "object",
        properties: {
          database: {
            type: "string",
            description: "Name of the database/bucket to write to",
          },
          data: {
            type: "string",
            description:
              "Line protocol formatted data. For multiple records, separate each line with \\n",
          },
          precision: {
            type: "string",
            enum: ["nanosecond", "microsecond", "millisecond", "second"],
            description: "Precision of timestamps",
          },
          acceptPartial: {
            type: "boolean",
            description: "Accept partial writes",
            default: true,
          },
          noSync: {
            type: "boolean",
            description: "Acknowledge without waiting for WAL persistence",
            default: false,
          },
        },
        required: ["database", "data", "precision"],
        additionalProperties: false,
      },
      zodSchema: z.object({
        database: z
          .string()
          .describe("Name of the database/bucket to write to"),
        data: z.string().describe("Line protocol formatted data"),
        precision: z
          .enum(["nanosecond", "microsecond", "millisecond", "second"])
          .describe("Precision of timestamps"),
        acceptPartial: z.boolean().optional().default(true),
        noSync: z.boolean().optional().default(false),
      }),
      handler: async (args) => {
        try {
          await influxService.write.writeLineProtocol(
            args.data,
            args.database,
            {
              precision: args.precision,
              acceptPartial: args.acceptPartial,
              noSync: args.noSync,
            },
          );

          return {
            content: [
              {
                type: "text",
                text: `Data written successfully to database/bucket '${args.database}'`,
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
