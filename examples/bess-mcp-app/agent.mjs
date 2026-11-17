import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { connection, launcher, root } from "./config.mjs";

let active;
const runs = new Map();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "influx-mcp-agent-"));
export function startAgent(prompt) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000)
    throw Error("Enter a prompt of 1–4000 characters.");
  if (active) throw Error("An agent is already running. Wait for its answer.");
  const run = {
    id: randomUUID(),
    status: "running",
    started_at: new Date().toISOString(),
    connection,
    events: [],
    answer: "",
  };
  runs.clear();
  runs.set(run.id, run);
  active = run;
  const instructions = `You are investigating the live ${connection.database} battery telemetry database on ${connection.product} through the InfluxDB 3 MCP server. Use only the provided MCP tools. Inspect the actual schema before writing SQL. Choose your own investigation and SQL based on the user question. Use bounded recent time windows and row limits for telemetry queries. Base conclusions on live tool results, report timestamp and query completeness, and distinguish simulated telemetry from physical evidence. Temperature above 70 C is the demo alert threshold. Keep the answer short and readable for a presentation. Do not write data, change configuration, or access credentials. Do not claim a full-cell check unless the query demonstrates it.`;
  const config = {
    command: process.execPath,
    args: [launcher],
    required: true,
  };
  const toml = `{command=${JSON.stringify(config.command)},args=${JSON.stringify(config.args)},required=true,enabled_tools=["load_database_context","get_help","health_check","list_databases","query_sql","query_influxql","list_tables","describe_table","investigate_database"]}`;
  const args = [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    "--color",
    "never",
    "-C",
    workspace,
    "-c",
    'approval_policy="on-request"',
    "-c",
    'approvals_reviewer="auto_review"',
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    'web_search="disabled"',
    "-c",
    `developer_instructions=${JSON.stringify(instructions)}`,
    "-c",
    `mcp_servers.bess=${toml}`,
    "-",
  ];
  const child = spawn(process.env.CODEX_BIN || "codex", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith("INFLUX") || key === "INFLUXDB_READ_TOKEN_FILE",
      ),
    ),
  });
  let buffer = "",
    diagnostics = "",
    finished = false;
  const timeout = setTimeout(() => {
    run.error = "Agent exceeded the three-minute run limit.";
    child.kill("SIGTERM");
  }, 180000);
  child.stdin.end(prompt);
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const event = JSON.parse(line),
          item = event.item;
        if (event.type === "error") run.error = event.message;
        if (item?.type === "mcp_tool_call") {
          const index = run.events.findIndex((e) => e.id === item.id);
          const entry = {
            id: item.id,
            tool: item.tool,
            arguments: item.arguments,
            status: item.status,
          };
          if (index < 0) run.events.push(entry);
          else run.events[index] = entry;
        }
        if (event.type === "item.completed" && item?.type === "agent_message")
          run.answer = item.text;
        if (event.type === "turn.failed")
          run.error = event.error?.message || "Agent turn failed.";
      } catch {
        // Ignore diagnostics that are not JSON protocol events.
      }
    }
  });
  const finish = async (code, error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    run.status =
      code === 0 && run.answer && !run.error ? "completed" : "failed";
    if (run.status === "failed")
      run.error =
        run.error ||
        error?.message ||
        diagnostics ||
        `Agent exited with code ${code}.`;
    run.finished_at = new Date().toISOString();
    active = null;
    const directory = path.join(root, ".runtime");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(directory, "agent-last.json"),
      JSON.stringify(run, null, 2),
      { mode: 0o600 },
    );
  };
  child.once("error", (error) => void finish(null, error));
  child.once("close", (code) => void finish(code));
  return { id: run.id };
}
export function getAgent(id) {
  return runs.get(id);
}
