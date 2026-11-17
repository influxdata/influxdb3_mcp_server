import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
import { setScenario } from "./scenario.mjs";

const uri = "ui://influxdb3/bess.html";
export async function createServer() {
  const catalog = await client.listTools();
  const readonlyTools = catalog.tools;
  const server = new Server(
    { name: "BESS MCP App example", version: "1.0.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: `This is simulated BESS telemetry in database ${connection.database}. Open open_bess to show the App. For investigations, inspect the schema and choose bounded recent SQL queries. Report query completeness and timestamps. Temperatures above 70°C are the demo threshold, not a physical diagnosis. Use your chat for the answer and tool evidence. The dashboard snapshot is a separate read.`,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...readonlyTools,
      ...["open_bess", "read_bess_snapshot"].map((name) => ({
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
      ...["heat_bess", "reset_bess"].map((name) => ({
        name,
        description:
          "Change only the local simulator scenario. Keep the simulator running.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: { ui: { visibility: ["app"] } },
      })),
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (readonlyTools.some((tool) => tool.name === params.name))
      return client.callTool(params);
    if (
      !["open_bess", "read_bess_snapshot", "heat_bess", "reset_bess"].includes(
        params.name,
      )
    )
      throw Error("Unknown tool");
    if (Object.keys(params.arguments || {}).length)
      throw Error("Unexpected arguments");
    try {
      if (["heat_bess", "reset_bess"].includes(params.name)) {
        const scenario = await setScenario(
          params.name === "heat_bess" ? "heat" : "reset",
        );
        return {
          content: [
            { type: "text", text: "Local simulator scenario updated." },
          ],
          structuredContent: { kind: "scenario", ...scenario },
        };
      }
      return {
        content: [
          { type: "text", text: `Live BESS data from ${connection.database}.` },
        ],
        structuredContent: await snapshot(),
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
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
  return server;
}
