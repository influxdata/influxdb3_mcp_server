import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { root, port } from "./config.mjs";
import { startAgent, getAgent } from "./agent.mjs";

const client = new Client({ name: "bess-browser-host", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "server.mjs")],
    stderr: "pipe",
  }),
);
const origin = `http://127.0.0.1:${port}`;
http
  .createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, origin);
      if (req.method === "POST") {
        if (req.headers.origin !== origin)
          return json(403, { error: "Origin rejected" });
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192)
            return json(413, { error: "Request too large" });
        }
        const input = JSON.parse(body);
        if (url.pathname === "/agent")
          return json(202, startAgent(input.prompt));
        if (url.pathname === "/tool") {
          if (!["open_bess", "read_bess_snapshot"].includes(input.name)) {
            return json(400, { error: "Tool not allowed" });
          }
          return json(200, await client.callTool(input));
        }
      }
      if (req.method !== "GET") return json(404, { error: "Not found" });
      if (url.pathname.startsWith("/agent/")) {
        const run = getAgent(url.pathname.slice(7));
        return json(run ? 200 : 404, run || { error: "Run not found" });
      }
      if (url.pathname === "/resource") {
        const resource = await client.readResource({
          uri: "ui://influxdb3/bess.html",
        });
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Cache-Control": "no-store",
        });
        return res.end(resource.contents[0].text);
      }
      const name =
        url.pathname === "/"
          ? "host.html"
          : url.pathname === "/host.js"
            ? "host.js"
            : null;
      if (!name) return json(404, { error: "Not found" });
      res.writeHead(200, {
        "Content-Type": name.endsWith(".js") ? "text/javascript" : "text/html",
      });
      res.end(await fs.readFile(path.join(root, "dist", name)));
    } catch (error) {
      json(500, { error: error.message });
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`BESS MCP App: ${origin}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => void client.close().finally(() => process.exit(0)));
}
