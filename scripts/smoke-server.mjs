import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const docker = process.argv[2] === "--docker";
const entry = process.argv[docker ? 3 : 2];
if (!entry || process.argv.length !== (docker ? 4 : 3))
  throw new Error(
    "Usage: pnpm run smoke:server INSTALLED_SERVER_ENTRY | --docker IMAGE",
  );
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (!docker) {
  const installedRoot =
    basename(dirname(entry)) === ".bin"
      ? realpathSync(resolve(dirname(entry), "..", pkg.name))
      : resolve(dirname(realpathSync(entry)), "..");
  const installed = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf8"),
  );
  assert.equal(installed.version, pkg.version);
  assert.equal(installed.mcpName, pkg.mcpName);
  accessSync(resolve(entry), constants.X_OK);
  accessSync(
    join(installedRoot, "docs/read-only-output-contract.md"),
    constants.R_OK,
  );
}
const target = Object.fromEntries(
  ["INFLUX_DB_INSTANCE_URL", "INFLUX_DB_TOKEN", "INFLUX_DB_PRODUCT_TYPE"].map(
    (name) => {
      const value = process.env[name];
      if (!value) throw new Error(`${name} is required`);
      return [name, value];
    },
  ),
);
const directory = mkdtempSync(join(tmpdir(), "mcp-packed-smoke-"));
// Let the image's default non-root user write non-secret smoke telemetry.
if (docker) chmodSync(directory, 0o777);
const summaries = [];
try {
  for (const profile of ["readonly", "readwrite", "operator"]) {
    const log = join(directory, `${profile}.jsonl`);
    const client = new Client({
      name: "packed-release-smoke",
      version: "1.0.0",
    });
    const serverEnv = {
      ...target,
      INFLUX_MCP_TOOL_PROFILE: profile,
      MCP_LOG_TOOL_CALLS: "true",
      MCP_LOG_BACKEND: "file",
      MCP_LOG_FILE: docker ? `/smoke/${profile}.jsonl` : log,
    };
    const transport = new StdioClientTransport({
      command: docker ? "docker" : resolve(entry),
      args: docker
        ? [
            "run",
            "--rm",
            "-i",
            "--volume",
            `${directory}:/smoke`,
            ...Object.keys(serverEnv).flatMap((name) => ["--env", name]),
            entry,
          ]
        : [],
      env: { ...process.env, ...serverEnv },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.version, pkg.version);
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      for (const name of [
        "query_sql",
        "query_influxql",
        "describe_table",
        "investigate_database",
      ])
        assert.ok(names.includes(name), `${profile} is missing ${name}`);
      assert.equal(
        names.includes("write_line_protocol"),
        profile !== "readonly",
      );
      assert.equal(names.includes("create_database"), profile !== "readonly");
      const result = await client.callTool({
        name: "query_sql",
        arguments: {
          db: process.env.INFLUX_TEST_DATABASE ?? "smoke",
          q: "SELECT 1 AS release_smoke",
          maxRows: 1,
        },
      });
      assert.notEqual(result.isError, true, `${profile} query failed`);
      const content = result.content.find((item) => item.type === "text");
      assert.ok(content && content.type === "text");
      const body = JSON.parse(content.text);
      assert.equal(body.ok, true);
      assert.deepEqual(body.rows, [{ release_smoke: 1 }]);
      assert.equal(body.metadata.completeness, "complete");
      const events = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(events.length, 1);
      assert.equal(events[0].tool_name, "query_sql");
      assert.equal(events[0].success, true);
      summaries.push({
        profile,
        version: pkg.version,
        tool_count: tools.length,
        query: "passed",
        telemetry_events: events.length,
      });
    } finally {
      await client.close();
    }
  }
  console.log(
    JSON.stringify(
      {
        server: docker ? entry : resolve(entry),
        product: target.INFLUX_DB_PRODUCT_TYPE,
        checks: summaries,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
