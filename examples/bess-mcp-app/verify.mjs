import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { launcher, root, connection } from "./config.mjs";
import { snapshot, client as dataClient } from "./data.mjs";

const upstream = new Client({
  name: "bess-example-verifier",
  version: "1.0.0",
});
const app = new Client({ name: "bess-example-ui-verifier", version: "1.0.0" });
try {
  await upstream.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [launcher],
      stderr: "pipe",
    }),
  );
  const catalog = await upstream.listTools();
  const allowed = new Set([
    "load_database_context",
    "get_help",
    "health_check",
    "list_databases",
    "list_tables",
    "describe_table",
    "investigate_database",
    "query_sql",
    "query_influxql",
  ]);
  assert(
    catalog.tools.length > 0 && catalog.tools.every((t) => allowed.has(t.name)),
    "Unexpected tool exposed by readonly profile",
  );
  const result = await snapshot();
  assert.equal(result.result.metadata.completeness, "complete");
  assert.equal(
    result.result.rows.length,
    768,
    "Start the simulator and check that all cells have fresh readings",
  );
  const packs = new Map();
  for (const row of result.result.rows)
    packs.set(row.pack_id, (packs.get(row.pack_id) || 0) + 1);
  assert.equal(packs.size, 4);
  assert([...packs.values()].every((n) => n === 192));
  if (process.argv.includes("--expect-hot")) {
    const hot = result.result.rows.find(
      (r) =>
        r.pack_id === "pack-0" &&
        r.module_id === "mod-3" &&
        r.cell_id === "cell-5",
    );
    assert.equal(hot.temperature_c, 80);
  }
  await app.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "server.mjs")],
      stderr: "pipe",
    }),
  );
  const tools = await app.listTools();
  assert.deepEqual(
    tools.tools.map((t) => t.name),
    ["open_bess", "read_bess_snapshot"],
  );
  const uri = tools.tools[0]._meta.ui.resourceUri;
  const resource = await app.readResource({ uri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert(resource.contents[0].text.includes("Ask an agent to investigate"));
  const opened = await app.callTool({ name: "open_bess", arguments: {} });
  assert(!opened.isError, "App tool failed");
  assert.equal(opened.structuredContent.result.rows.length, 768);
  console.log(
    JSON.stringify({
      database: connection.database,
      cells: 768,
      packs: 4,
      completeness: "complete",
      readonly_tools: catalog.tools.length,
      app_resource: uri,
    }),
  );
} finally {
  await Promise.all([upstream.close(), app.close(), dataClient.close()]);
}
