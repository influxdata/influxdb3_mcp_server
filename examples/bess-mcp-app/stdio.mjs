import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.mjs";
import { client } from "./data.mjs";
const server = await createServer();
await server.connect(new StdioServerTransport());
process.stdin.on(
  "end",
  () => void client.close().finally(() => process.exit(0)),
);
