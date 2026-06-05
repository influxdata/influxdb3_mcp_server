/**
 * Help and Documentation Tools
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { McpTool } from "../index.js";

export function createHelpTools(
  influxService: InfluxDBMasterService,
): McpTool[] {
  return [
    {
      name: "load_database_context",
      description:
        "Check for and load custom database context if available. Always check this first as it can significantly speed up analysis and clarify data nuances. User-provided context is optional but when present, it contains valuable information about database structure, business context, or personal notes that can guide more accurate analysis.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      zodSchema: z.object({}),
      handler: async (_args) => {
        try {
          const contextFile = await influxService.contextFile.loadContextFile();

          if (!contextFile) {
            return {
              content: [
                {
                  type: "text",
                  text: `No custom context file found.

User-provided context is optional. If users want to provide context, they can:
1. Create a file in /context/ folder (any .json, .txt, .md file)
2. Or create a file with 'context' in the name (.json, .txt, .md)

Context can include anything helpful:
- Database schema and measurement descriptions
- Business context or data purposes
- Simple notes about their setup
- Personal context ("I'm tracking my daily activities")

Proceed with database exploration using available tools.`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Custom context loaded from: ${contextFile.name}.${contextFile.extension}

${contextFile.content}

Use this context to guide subsequent database operations and analysis.`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error loading context: ${error.message}

Context is optional - proceed with database exploration using available tools.`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "get_help",
      description:
        "Get help and troubleshooting guidance for InfluxDB operations. Supports specific categories or keyword search.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      zodSchema: z.object({}),
      handler: async (_args) => {
        try {
          const helpContent = influxService.help.getHelp();
          return {
            content: [
              {
                type: "text",
                text: helpContent,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting help: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  ];
}
