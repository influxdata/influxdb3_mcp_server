import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { connection, root } from "./config.mjs";
import { client, snapshot } from "./data.mjs";

const uri = "ui://influxdb3/bess.html";
const server = new Server(
  { name: "BESS MCP App example", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ["open_bess", "read_bess_snapshot"].map((name) => ({
    name,
    description:
      name === "open_bess"
        ? "Open a live BESS telemetry view. The view's telemetry query is a dashboard read, not an autonomous agent investigation."
        : "Read a bounded snapshot of current BESS cells for the dashboard.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: { ui: { resourceUri: uri }, "ui/resourceUri": uri },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (!["open_bess", "read_bess_snapshot"].includes(params.name)) {
    throw Error("Unknown tool");
  }
  if (Object.keys(params.arguments || {}).length)
    throw Error("Unexpected arguments");
  try {
    return {
      content: [
        { type: "text", text: `Live BESS data from ${connection.database}.` },
      ],
      structuredContent: await snapshot(),
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri, name: "BESS", mimeType: "text/html;profile=mcp-app" }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  if (params.uri !== uri) throw Error("Unknown resource");
  return {
    contents: [
      {
        uri,
        mimeType: "text/html;profile=mcp-app",
        text: await fs.readFile(path.join(root, "dist/app.html"), "utf8"),
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
      },
    ],
  };
});
await server.connect(new StdioServerTransport());
process.stdin.on(
  "end",
  () => void client.close().finally(() => process.exit(0)),
);
