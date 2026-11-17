import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";
import { connection, launcher, root } from "./config.mjs";

export const client = new Client({ name: "bess-app-reader", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [launcher],
    stderr: "pipe",
  }),
);
export function unwrap(raw) {
  return (
    raw.structuredContent ||
    JSON.parse(
      raw.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
    )
  );
}
export const snapshotSql = `SELECT time, pack_id, module_id, cell_id, voltage, temperature_c
FROM (
  SELECT time, site, pack_id, module_id, cell_id, voltage, temperature_c,
    ROW_NUMBER() OVER (
      PARTITION BY site, pack_id, module_id, cell_id ORDER BY time DESC
    ) AS cell_rank
  FROM cell_readings
  WHERE time >= NOW() - INTERVAL '30 seconds'
) AS recent_cells
WHERE cell_rank = 1
ORDER BY pack_id, module_id, cell_id
LIMIT 1000`;

export async function snapshot() {
  const args = { db: connection.database, q: snapshotSql, format: "json" };
  const raw = await client.callTool({ name: "query_sql", arguments: args });
  const result = unwrap(raw);
  if (raw.isError || result.ok === false) {
    throw Error(result.error?.message || JSON.stringify(result));
  }
  const evidence = {
    kind: "snapshot",
    checked_at: new Date().toISOString(),
    connection,
    tool: "query_sql",
    arguments: args,
    result,
  };
  await fs.mkdir(path.join(root, ".runtime"), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(root, ".runtime/snapshot-last.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  return evidence;
}
