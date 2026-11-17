import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { launcher, root, connection } from "./config.mjs";
import { snapshot, unwrap, client as dataClient } from "./data.mjs";

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
      args: [path.join(root, "stdio.mjs")],
      stderr: "pipe",
    }),
  );
  const tools = await app.listTools();
  assert.deepEqual(
    tools.tools
      .filter((t) => allowed.has(t.name))
      .map((t) => t.name)
      .sort(),
    catalog.tools.map((t) => t.name).sort(),
  );
  assert.deepEqual(
    tools.tools.filter((t) => !allowed.has(t.name)).map((t) => t.name),
    ["open_bess", "read_bess_snapshot", "heat_bess", "reset_bess"],
  );
  for (const name of ["heat_bess", "reset_bess"]) {
    const tool = tools.tools.find((t) => t.name === name);
    assert.deepEqual(tool._meta.ui.visibility, ["app"]);
    assert.equal(tool.annotations.readOnlyHint, false);
  }
  const uri = tools.tools.find((t) => t.name === "open_bess")._meta.ui
    .resourceUri;
  const resource = await app.readResource({ uri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert(resource.contents[0].text.includes("Ask an agent to investigate"));
  const opened = await app.callTool({ name: "open_bess", arguments: {} });
  assert(!opened.isError, "App tool failed");
  assert.equal(opened.structuredContent.result.rows.length, 768);
  const schema = await app.callTool({
    name: "describe_table",
    arguments: { db: connection.database, table: "cell_readings" },
  });
  assert(!schema.isError, "Combined server schema inspection failed");
  const query = {
    name: "query_sql",
    arguments: {
      db: connection.database,
      q: "SELECT pack_id, MAX(temperature_c) AS max_temperature_c FROM cell_readings WHERE time >= NOW() - INTERVAL '30 seconds' GROUP BY pack_id ORDER BY pack_id LIMIT 10",
      format: "json",
    },
  };
  const queried = await app.callTool(query);
  assert(!queried.isError, "Combined server query failed");
  assert.equal(unwrap(queried).rows.length, 4);
  const httpIndex = process.argv.indexOf("--http");
  if (httpIndex !== -1) {
    const remote = new Client({ name: "bess-http-verifier", version: "1.0.0" });
    try {
      await remote.connect(
        new StreamableHTTPClientTransport(new URL(process.argv[httpIndex + 1])),
      );
      assert.deepEqual(
        (await remote.listTools()).tools.map((t) => t.name),
        tools.tools.map((t) => t.name),
      );
      assert.equal(
        (await remote.readResource({ uri })).contents[0].mimeType,
        "text/html;profile=mcp-app",
      );
      assert.equal(
        (await remote.callTool({ name: "open_bess", arguments: {} }))
          .structuredContent.result.rows.length,
        768,
      );
      assert.equal(unwrap(await remote.callTool(query)).rows.length, 4);
    } finally {
      await remote.close();
    }
  }
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
