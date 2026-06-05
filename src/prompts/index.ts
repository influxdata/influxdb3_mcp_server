/**
 * MCP Prompts Definitions
 *
 * Defines reusable prompt templates for InfluxDB operations
 */

import { InfluxDBMasterService } from "../services/influxdb-master.service.js";

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  handler: (args?: Record<string, string>) => Promise<{
    description: string;
    messages: Array<{
      role: string;
      content:
        | { type: "text"; text: string }
        | {
            type: "resource";
            resource: {
              uri: string;
              mimeType: string;
              text: string;
            };
          };
    }>;
  }>;
}

/**
 * Create simple MCP prompts for InfluxDB operations
 */
export function createPrompts(
  influxService: InfluxDBMasterService,
): McpPrompt[] {
  return [
    {
      name: "list-databases",
      description: "Generate a prompt to list all available databases",
      handler: async () => {
        return {
          description: "List all available InfluxDB databases",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please list all available databases in this InfluxDB instance. Use the list_databases tool to show me what databases are available.",
              },
            },
          ],
        };
      },
    },

    {
      name: "check-health",
      description: "Generate a prompt to check InfluxDB health status",
      handler: async () => {
        return {
          description: "Check InfluxDB server health and connection status",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please check the health status of the InfluxDB server. Use the health_check tool to verify the connection and show me the server status.",
              },
            },
          ],
        };
      },
    },

    {
      name: "load-context",
      description: "Load custom database context and documentation",
      handler: async () => {
        const contextFile = await influxService.contextFile.loadContextFile();

        if (!contextFile) {
          return {
            description: "No context file found",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "No context file was found. Create a file in /context/ folder or name a file with 'context' in the name (.json, .txt, .md) to provide custom database documentation.",
                },
              },
            ],
          };
        }

        let mimeType = "text/plain";
        switch (contextFile.extension) {
          case "json":
            mimeType = "application/json";
            break;
          case "md":
            mimeType = "text/markdown";
            break;
          case "txt":
          default:
            mimeType = "text/plain";
            break;
        }

        return {
          description: `Load context from ${contextFile.name}.${contextFile.extension}`,
          messages: [
            {
              role: "user",
              content: {
                type: "resource",
                resource: {
                  uri: "influx://context",
                  mimeType: mimeType,
                  text: contextFile.content,
                },
              },
            },
          ],
        };
      },
    },
  ];
}
