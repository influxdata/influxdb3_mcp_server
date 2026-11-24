import { z } from "zod";
import { InfluxDBMasterService } from "../services/influxdb-master.service.js";
import { ToolProfile } from "../config.js";
import { createHelpTools } from "./categories/help.tools.js";
import { createWriteTools } from "./categories/write.tools.js";
import { createDatabaseTools } from "./categories/database.tools.js";
import { createQueryTools } from "./categories/query.tools.js";
import { createTokenTools } from "./categories/token.tools.js";
import { createCloudTokenTools } from "./categories/cloud-token.tools.js";
import { createHealthTools } from "./categories/health.tools.js";

export interface McpTool {
  name: string;
  /** The smallest INFLUX_MCP_TOOL_PROFILE that advertises this tool. */
  minimumProfile: ToolProfile;
  /**
   * Arguments the schema no longer lists but the handler still receives, so
   * it can refuse them with a specific error instead of "unexpected field".
   */
  refusedLegacyArguments?: string[];
  description: string;
  inputSchema: Record<string, any>;
  zodSchema: z.ZodSchema;
  handler: (args: any) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
}

const PROFILE_RANK: Record<ToolProfile, number> = {
  readonly: 0,
  readwrite: 1,
  operator: 2,
};

export function createTools(influxService: InfluxDBMasterService): McpTool[] {
  const tools = [
    ...createHelpTools(influxService),
    ...createWriteTools(influxService),
    ...createDatabaseTools(influxService),
    ...createQueryTools(influxService),
    ...createTokenTools(influxService),
    ...createCloudTokenTools(influxService),
    ...createHealthTools(influxService),
  ];

  const profile = influxService.getConfig().tools.profile;
  return tools.filter(
    (tool) => PROFILE_RANK[tool.minimumProfile] <= PROFILE_RANK[profile],
  );
}
