#!/usr/bin/env node

/**
 * Standalone InfluxDB 3 MCP Server
 *
 * Main entry point for the MCP server that provides InfluxDB integration
 * for Claude Desktop and other MCP clients.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server/index.js";

async function main() {
  try {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] InfluxDB 3 MCP Server started successfully");
  } catch (error) {
    console.error("[MCP] Failed to start server:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.error("[MCP] Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("[MCP] Shutting down...");
  process.exit(0);
});

main().catch((error) => {
  console.error("[MCP] Server error:", error);
  process.exit(1);
});
