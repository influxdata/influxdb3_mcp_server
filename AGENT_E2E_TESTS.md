# Agent E2E Test Plan

Use this plan to test the MCP server through real agent harnesses such as
Codex, Claude Code, or OpenCode. The test cases are harness-agnostic: they
define the server mode, prompt, and expected behavior. Harness-specific
sections translate those cases into concrete runner commands.

Do not store token values in config files, output files, or transcripts.
Export credentials in the parent shell or pass them inline when running a
single command.

## Recording Template

For each run, record:

- Test ID
- Harness name and configuration
- Server mode and product
- Model and reasoning effort, if the harness exposes them
- Prompt
- Tool calls used
- Failed tool calls
- Whether shell commands were used
- Final answer quality
- Wall-clock time
- Visible token stats, if the harness exposes them
- Telemetry log lines

Codex does not currently expose raw per-run token usage. If a harness provides
a visible stats line, copy it into the run notes. If not, record `null`; for
Codex, note that `/usage daily` is aggregated only.

## Test Cases

| ID                        | Server mode | Product    | Suggested effort | Prompt                                                                                                                                              | Expected behavior                                                                                                                                                             |
| ------------------------- | ----------- | ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ro-happy-host-cpu`       | read-only   | Enterprise | low              | `Use MCP. List databases. Find host_system. Show CPU usage from metrics as JSON.`                                                                   | Uses only read-only MCP tools. Lists databases, finds `host_system`, identifies `metrics`, runs one bounded query, and returns JSON rows, `row_count`, and `query_id_source`. |
| `ro-absent-table`         | read-only   | Enterprise | low              | `Use the Enterprise read-only MCP server. Find where a table named smoke exists. If found, run select * from smoke.`                                | Uses `list_databases` and `list_tables`. Does not run `query_sql` if no table exists. Returns `status: not_run` or equivalent.                                                |
| `ro-db-typo-recovery`     | read-only   | Enterprise | low              | `Use MCP. List databases. Find the system_host db. Query metrics.`                                                                                  | Finds that `system_host` is absent. Uses `host_system` only if it is the only clear match, and states the assumption before querying.                                         |
| `ro-wildcard-field-low`   | read-only   | Enterprise | low              | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                       | Handles quoted `*` as literal. Recovers by schema inspection, explicit SQL field expansion, or InfluxQL regex. Returns matching CPU fields.                                   |
| `ro-wildcard-field-high`  | read-only   | Enterprise | high             | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                       | Same acceptance criteria as `ro-wildcard-field-low`. Compare tool calls, failed calls, wall-clock time, and output length.                                                    |
| `ro-influxql-regex`       | read-only   | Enterprise | low              | `Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics.`                                                              | Chooses `query_influxql`, uses a regex-style field query where appropriate, and returns JSON output and query metadata.                                                       |
| `default-readonly-intent` | default     | Enterprise | low              | `Use MCP. List databases and show CPU usage from metrics. Do not write or administer anything.`                                                     | With the full/default server configured, chooses read-only tools for read-only intent. This is a quality test, not the safety boundary.                                       |
| `ro-core-parity`          | read-only   | Core       | low              | `Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.` | Core read-only profile exposes the same safe tool surface and returns the same structured metadata shape.                                                                     |

## Harness-Specific Execution

### Codex CLI

Map the harness-agnostic server modes to Codex profiles:

| Server mode | Product    | Codex profile           | MCP server config key       |
| ----------- | ---------- | ----------------------- | --------------------------- |
| read-only   | Enterprise | `influxdb3-mcp-dev-ro`  | `influxdb3_ent_mcp_dev_ro`  |
| default     | Enterprise | `influxdb3-mcp-dev`     | `influxdb3_ent_mcp_dev`     |
| read-only   | Core       | `influxdb3-mcp-core-ro` | `influxdb3_core_mcp_dev_ro` |

Interactive read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex --profile influxdb3-mcp-dev-ro
```

Non-interactive `codex exec` runs should approve only the relevant MCP server tools. The commands below set `default_tools_approval_mode="approve"` for the MCP server used by that profile. This avoids `user cancelled MCP tool call` failures while preserving normal shell-command sandbox and approval behavior. If your MCP server names differ, update the `mcp_servers.<name>` key.

Read-only happy path:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-happy-host-cpu.md \
  'Use MCP. List databases. Find host_system. Show CPU usage from metrics as JSON. Return db, row_count, query_id_source, and any error code.'
```

Absent table:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-absent-table.md \
  'Use the Enterprise read-only MCP server. Do not use shell commands. Find where a table named smoke exists. If found, run select * from smoke. Return JSON.'
```

Database typo recovery:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-db-typo-recovery.md \
  'Use MCP. List databases. Find the system_host db. Query metrics. If the database name is wrong, state the assumption before querying.'
```

Wildcard field recovery, low reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-wildcard-field-low.md \
  'Use MCP. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

Wildcard field recovery, high reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"high"' \
  -o e2e-ro-wildcard-field-high.md \
  'Use MCP. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

InfluxQL regex:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-influxql-regex.md \
  'Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics. Return JSON rows and query metadata.'
```

Default/full server quality run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-default-readonly-intent.md \
  'Use MCP. List databases and show CPU usage from metrics. Do not write, delete, create, update, or administer anything.'
```

Core read-only parity:

```sh
INFLUX_DB_TOKEN=<core-token> codex exec \
  --profile influxdb3-mcp-core-ro \
  -c 'mcp_servers.influxdb3_core_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-core-readonly-parity.md \
  'Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.'
```

## Telemetry Checks

When `MCP_LOG_BACKEND=file` is configured, compare the agent transcript to
the telemetry JSONL file:

- The telemetry line count should match the number of MCP tool calls.
- Query results should correlate by `request_id` or `query_id`.
- No token-like values should appear in the transcript or telemetry file.

Example log inspection:

```sh
tail -f /tmp/influxdb-mcp-logs/enterprise-readonly.jsonl
jq -c . /tmp/influxdb-mcp-logs/enterprise-readonly.jsonl
```
