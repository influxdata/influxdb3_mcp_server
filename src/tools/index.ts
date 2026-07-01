/**
 * MCP Tools Definitions
 *
 * Defines all the tools available through the MCP server
 */

import { z } from "zod";
import { InfluxDBMasterService } from "../services/influxdb-master.service.js";
import { createHelpTools } from "./categories/help.tools.js";
import { createWriteTools } from "./categories/write.tools.js";
import { createDatabaseTools } from "./categories/database.tools.js";
import { createQueryTools } from "./categories/query.tools.js";
import { createTokenTools } from "./categories/token.tools.js";
import { createCloudTokenTools } from "./categories/cloud-token.tools.js";
import { createHealthTools } from "./categories/health.tools.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  zodSchema: z.ZodSchema;
  handler: (args: any) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

const READONLY_TOOLS = new Set([
  "load_database_context",
  "get_help",
  "health_check",
  "list_databases",
  "query_sql",
  "query_influxql",
  "list_tables",
  "describe_table",
  "investigate_database",
]);

/**
 * Creates all MCP tools by aggregating them from organized categories
 */
export function createTools(influxService: InfluxDBMasterService): McpTool[] {
  const tools = [
    ...createHelpTools(influxService),
    ...createWriteTools(influxService),
    ...createDatabaseTools(influxService),
    ...createQueryTools(influxService),
    ...createTokenTools(influxService),
    ...createCloudTokenTools(influxService),
    // ...createSchemaTools(influxService),
    ...createHealthTools(influxService),
  ];

  const profile =
    influxService.getConfig().tools?.profile ||
    process.env.INFLUX_MCP_TOOL_PROFILE ||
    "operator";

  if (profile === "readonly") {
    return tools.filter((tool) => READONLY_TOOLS.has(tool.name));
  }

  return tools;
}
