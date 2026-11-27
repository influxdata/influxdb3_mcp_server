#!/usr/bin/env node
// Calls the Core and Enterprise token-management tools through the built MCP
// server, in a fixed order, with no agent involved. Use it to check which tools
// a server and token allow, such as on InfluxDB 3 Cloud.
//
// Usage: node scripts/check-token-tools.mjs [results.json]
// Environment: INFLUX_DB_INSTANCE_URL, INFLUX_DB_TOKEN (admin), and
// INFLUX_TEST_DATABASE, an existing database for the test resource token.
//
// It creates two tokens named mcp-tooltest-*, with a 1-hour expiry, then
// deletes them. It never calls regenerate_operator_token. Token values are
// redacted before anything is printed or saved.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = fileURLToPath(new URL("../build/index.js", import.meta.url));
const REQUIRED = [
  "INFLUX_DB_INSTANCE_URL",
  "INFLUX_DB_TOKEN",
  "INFLUX_TEST_DATABASE",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}
const outFile = process.argv[2];
if (outFile && existsSync(outFile)) {
  console.error(`${outFile} exists; not overwriting`);
  process.exit(2);
}

const secrets = [process.env.INFLUX_DB_TOKEN];
const redact = (text) =>
  secrets
    .reduce((out, secret) => out.split(secret).join("[REDACTED]"), text)
    .replace(/apiv3_[\w\-+/=]+/g, "[REDACTED]");

const client = new Client({ name: "check-token-tools", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: {
      PATH: process.env.PATH ?? "",
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL,
      INFLUX_DB_TOKEN: process.env.INFLUX_DB_TOKEN,
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_MCP_TOOL_PROFILE: "operator",
    },
    stderr: "ignore",
  }),
);

const results = [];
async function call(tool, args = {}) {
  let result;
  try {
    result = await client.callTool({ name: tool, arguments: args });
  } catch (error) {
    result = {
      isError: true,
      content: [{ type: "text", text: `protocol error: ${error.message}` }],
    };
  }
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  const created = text.match(/^Token: (\S+)$/m)?.[1];
  if (created) secrets.push(created);
  const entry = {
    tool,
    args,
    isError: result.isError === true,
    text: redact(text),
  };
  results.push(entry);
  const status = entry.isError ? "ERROR" : "ok   ";
  console.log(`${status} ${tool}: ${entry.text.split("\n")[0].slice(0, 160)}`);
  return entry;
}

const stamp = Date.now();
const adminName = `mcp-tooltest-admin-${stamp}`;
const resourceName = `mcp-tooltest-resource-${stamp}`;
const advertised = (await client.listTools()).tools
  .map((tool) => tool.name)
  .filter((name) => name.includes("token"));

await call("list_admin_tokens");
await call("list_resource_tokens");
const resource = await call("create_resource_token", {
  description: resourceName,
  databases: [process.env.INFLUX_TEST_DATABASE],
  actions: ["read"],
  expiry_secs: 3600,
});
const admin = await call("create_admin_token", {
  name: adminName,
  expiry_secs: 3600,
});
if (!resource.isError) await call("delete_token", { token_name: resourceName });
if (!admin.isError) await call("delete_token", { token_name: adminName });
await call("list_admin_tokens", { tokenName: "mcp-tooltest" });
await call("list_resource_tokens", { tokenName: "mcp-tooltest" });
await client.close();

const report = redact(
  JSON.stringify({ advertised, adminName, resourceName, results }, null, 2),
);
if (secrets.some((secret) => report.includes(secret))) {
  console.error("A token value survived redaction. Nothing was saved.");
  process.exit(1);
}
if (outFile) {
  writeFileSync(outFile, `${report}\n`);
  console.log(`saved ${outFile}`);
}
process.exit(results.some((entry) => entry.isError) ? 1 : 0);
