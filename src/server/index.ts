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

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const validatedArgs = tool.zodSchema.parse(args || {});

    try {
      return await tool.handler(validatedArgs);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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
