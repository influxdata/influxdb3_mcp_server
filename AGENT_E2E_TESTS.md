# Agent E2E Test Plan

Use this plan to test the MCP server through real Codex agent runs. Use
Codex `--profile` configurations to switch between the default/full MCP
server and the read-only MCP server.

Do not store token values in config files, output files, or transcripts.
Export `INFLUX_DB_TOKEN` in the parent shell or pass it inline when running a
single command.

## Recording Template

For each run, record:

- Test ID
- Codex profile
- Model and reasoning effort
- Prompt
- Tool calls used
- Failed tool calls
- Whether shell commands were used
- Final answer quality
- Wall-clock time
- Visible Codex token stats, if available
- Telemetry log lines

Codex does not currently expose raw per-run token usage. If a visible stats
line is available, copy it into the run notes. If not, record `null` and note
that `/usage daily` is aggregated only.

## Test Cases

| ID                        | Profile                 | Reasoning | Prompt                                                                                                                                              | Expected behavior                                                                                                                                                             |
| ------------------------- | ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ro-happy-host-cpu`       | `influxdb3-mcp-dev-ro`  | low       | `Use MCP. List databases. Find host_system. Show CPU usage from metrics as JSON.`                                                                   | Uses only read-only MCP tools. Lists databases, finds `host_system`, identifies `metrics`, runs one bounded query, and returns JSON rows, `row_count`, and `query_id_source`. |
| `ro-absent-table`         | `influxdb3-mcp-dev-ro`  | low       | `Use the Enterprise read-only MCP server. Find where a table named smoke exists. If found, run select * from smoke.`                                | Uses `list_databases` and `list_tables`. Does not run `query_sql` if no table exists. Returns `status: not_run` or equivalent.                                                |
| `ro-db-typo-recovery`     | `influxdb3-mcp-dev-ro`  | low       | `Use MCP. List databases. Find the system_host db. Query metrics.`                                                                                  | Finds that `system_host` is absent. Uses `host_system` only if it is the only clear match, and states the assumption before querying.                                         |
| `ro-wildcard-field-low`   | `influxdb3-mcp-dev-ro`  | low       | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                       | Handles quoted `*` as literal. Recovers by schema inspection, explicit SQL field expansion, or InfluxQL regex. Returns matching CPU fields.                                   |
| `ro-wildcard-field-high`  | `influxdb3-mcp-dev-ro`  | high      | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                       | Same acceptance criteria as `ro-wildcard-field-low`. Compare tool calls, failed calls, wall-clock time, and output length.                                                    |
| `ro-influxql-regex`       | `influxdb3-mcp-dev-ro`  | low       | `Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics.`                                                              | Chooses `query_influxql`, uses a regex-style field query where appropriate, and returns JSON output and query metadata.                                                       |
| `default-readonly-intent` | `influxdb3-mcp-dev`     | low       | `Use MCP. List databases and show CPU usage from metrics. Do not write or administer anything.`                                                     | With the full/default server configured, chooses read-only tools for read-only intent. This is a quality test, not the safety boundary.                                       |
| `ro-core-parity`          | `influxdb3-mcp-core-ro` | low       | `Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.` | Core read-only profile exposes the same safe tool surface and returns the same structured metadata shape.                                                                     |

## Commands

Interactive read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex --profile influxdb3-mcp-dev-ro
```

Read-only happy path:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-happy-host-cpu.md \
  'Use MCP. List databases. Find host_system. Show CPU usage from metrics as JSON. Return db, row_count, query_id_source, and any error code.'
```

Absent table:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-absent-table.md \
  'Use the Enterprise read-only MCP server. Do not use shell commands. Find where a table named smoke exists. If found, run select * from smoke. Return JSON.'
```

Database typo recovery:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-db-typo-recovery.md \
  'Use MCP. List databases. Find the system_host db. Query metrics. If the database name is wrong, state the assumption before querying.'
```

Wildcard field recovery, low reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-wildcard-field-low.md \
  'Use MCP. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

Wildcard field recovery, high reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"high"' \
  -o e2e-ro-wildcard-field-high.md \
  'Use MCP. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

InfluxQL regex:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-ro-influxql-regex.md \
  'Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics. Return JSON rows and query metadata.'
```

Default/full server quality run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev \
  -c model_reasoning_effort='"low"' \
  -o e2e-default-readonly-intent.md \
  'Use MCP. List databases and show CPU usage from metrics. Do not write, delete, create, update, or administer anything.'
```

Core read-only parity:

```sh
INFLUX_DB_TOKEN=<core-token> codex exec \
  --profile influxdb3-mcp-core-ro \
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
