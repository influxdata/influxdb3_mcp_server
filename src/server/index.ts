/**
 * MCP Server Factory
 *
 * Creates and configures the MCP server with all capabilities
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, validateConfig } from "../config.js";
import { InfluxDBMasterService } from "../services/influxdb-master.service.js";
import { createTools } from "../tools/index.js";
import { createResources } from "../resources/index.js";
import { createPrompts } from "../prompts/index.js";
import { createRequestId, logToolCall } from "../services/telemetry.service.js";

function parseToolPayload(result: {
  content: Array<{ type: string; text: string }>;
}): any | undefined {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function logMcpToolResult(
  toolName: string,
  fallbackRequestId: string,
  startedAt: number,
  result: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  },
): void {
  const payload = parseToolPayload(result);
  const metadata = payload?.metadata || {};
  const success = !result.isError && payload?.ok !== false;

  logToolCall({
    tool_name: toolName,
    request_id: metadata.request_id || fallbackRequestId,
    query_id: metadata.query_id,
    timestamp_ms: startedAt,
    duration_ms: Date.now() - startedAt,
    db: payload?.db,
    row_count: metadata.row_count,
    truncated: metadata.truncated,
    success,
    error_code: success ? undefined : payload?.error?.code || "tool_error",
  });
}

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const config = loadConfig();
  validateConfig(config);

  const influxService = new InfluxDBMasterService(config);

  const tools = createTools(influxService);
  const resources = createResources(influxService);
  const prompts = createPrompts(influxService);

  const server = new Server(
    {
      name: config.server.name,
      version: config.server.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    const requestId = createRequestId();
    const startedAt = Date.now();

    if (!tool) {
      logToolCall({
        tool_name: name,
        request_id: requestId,
        timestamp_ms: startedAt,
        duration_ms: Date.now() - startedAt,
        success: false,
        error_code: "unknown_tool",
      });
      throw new Error(`Unknown tool: ${name}`);
    }

    const validatedArgs = tool.zodSchema.parse(args || {});

    try {
      const result = await tool.handler(validatedArgs);
      logMcpToolResult(name, requestId, startedAt, result);
      return result;
    } catch (error) {
      logToolCall({
        tool_name: name,
        request_id: requestId,
        timestamp_ms: startedAt,
        duration_ms: Date.now() - startedAt,
        success: false,
        error_code: "tool_exception",
      });
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resources.map((resource) => ({
        name: resource.name,
        uri: resource.uri,
        description: resource.description,
        mimeType: "application/json",
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const resource = resources.find((r) => r.uri === uri);

    if (!resource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    return await resource.handler();
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments || [],
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = prompts.find((p) => p.name === name);

    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    return await prompt.handler(args);
  });

  server.setRequestHandler(PingRequestSchema, async () => {
    return {};
  });

  console.warn(
    `[MCP] Server initialized with ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`,
  );

  return server;
}
