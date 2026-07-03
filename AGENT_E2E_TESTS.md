# Agent E2E Test Plan

Use this plan to test the MCP server through real agent harnesses such as
Codex, Claude Code, or OpenCode. The test cases are harness-agnostic: they
define the server mode, prompt, and expected behavior. Harness-specific
sections translate those cases into concrete runner commands.

Do not store token values in config files, output files, or transcripts.
Export credentials in the parent shell or pass them inline when running a
single command.

## MCP-Only Prompt Discipline

These E2E cases test the MCP server through an agent harness, not the agent's
ability to edit this repository. When the harness runs from the MCP server
repo, prompts that ask the agent to "fix", "improve", or "make it easier next
time" can trigger code inspection and repository edits instead of MCP-only
database work.

For MCP-only tests, include constraints such as:

```text
Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands.
```

Avoid ambiguous improvement prompts unless the test intentionally measures
whether the agent crosses from MCP tool use into repository modification.

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

| ID                         | Server mode | Product    | Suggested effort | Prompt                                                                                                                                                    | Expected behavior                                                                                                                                                                                         |
| -------------------------- | ----------- | ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ro-happy-host-cpu`        | read-only   | Enterprise | low              | `Use MCP. List databases. Find host_system. Show CPU usage from metrics as JSON.`                                                                         | Uses only read-only MCP tools. Lists databases, finds `host_system`, identifies `metrics`, runs one bounded query, and returns JSON rows, `row_count`, and `query_id_source`.                             |
| `ro-absent-table`          | read-only   | Enterprise | low              | `Use the Enterprise read-only MCP server. Find where a table named smoke exists. If found, run select * from smoke.`                                      | Uses `list_databases` and `list_tables`. Does not run `query_sql` if no table exists. Returns `status: not_run` or equivalent.                                                                            |
| `ro-db-typo-recovery`      | read-only   | Enterprise | low              | `Use MCP. List databases. Find the system_host db. Query metrics.`                                                                                        | Finds that `system_host` is absent. Uses `host_system` only if it is the only clear match, and states the assumption before querying.                                                                     |
| `ro-wildcard-field-low`    | read-only   | Enterprise | low              | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                             | Treats the quoted `*` as wildcard intent, uses `describe_table`, expands matching fields explicitly, and runs one bounded `query_sql`. Avoids InfluxQL unless SQL recovery fails.                         |
| `ro-wildcard-field-high`   | read-only   | Enterprise | high             | `Use MCP. In host_system, select "cpu::usage*" from metrics.`                                                                                             | Same acceptance criteria as `ro-wildcard-field-low`. Compare tool calls, failed calls, wall-clock time, and output length.                                                                                |
| `ro-influxql-regex`        | read-only   | Enterprise | low              | `Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics.`                                                                    | Chooses `query_influxql`, uses a regex-style field query where appropriate, and returns JSON output and query metadata.                                                                                   |
| `safety-conditional-write` | comparison  | Enterprise | low              | `Use MCP. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it.` | Run once with read-only and once with default. Read-only must not write and should report that mutation is unavailable. Default may write the row; record any mutation and clean up separately if needed. |
| `eff-broad-schema-cpu`     | comparison  | Enterprise | low              | `Use MCP. Across all databases, find every table with cpu::usage fields and return one sample row per matching table.`                                    | Run once with read-only and once with default. Uses database/table/schema discovery, queries only matching tables, keeps queries bounded, and compares tool calls, tokens, and failed calls.              |
| `default-readonly-intent`  | default     | Enterprise | low              | `Use MCP. List databases and show CPU usage from metrics. Do not write or administer anything.`                                                           | With the full/default server configured, chooses read-only tools for read-only intent. This is a quality test, not the safety boundary.                                                                   |
| `ro-core-parity`           | read-only   | Core       | low              | `Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.`       | Core read-only profile exposes the same safe tool surface and returns the same structured metadata shape.                                                                                                 |

## Recovery Expectations

For SQL prompts with quoted wildcard selectors, prefer the shortest grounded
recovery path:

1. If `query_sql` fails with a quoted wildcard or unknown-field selector, use
   `metadata.recovery_hint.recommended_next_tool` when present. The expected
   value is `describe_table`.
2. Call `describe_table` for the target table.
3. Expand matching fields explicitly from the schema.
4. Run one bounded `query_sql`.
5. Use `query_influxql` regex only when the user explicitly asks for InfluxQL
   or regex field selection, or when SQL field expansion cannot satisfy the
   request.

For `ro-wildcard-field-low`, the target tool path is:

```text
list_databases
list_tables
describe_table
query_sql failed or skipped
query_sql with explicit fields
```

If `describe_table` proves the wildcard expansion before the first query, the
preferred path skips the doomed literal `query_sql` and runs only the explicit
field query.

## Comparison Expectations

Use comparison cases to measure differences between server modes. Run each case
once with the read-only profile and once with the default/full profile against
the same disposable test instance.

- `safety-conditional-write`: the read-only run passes only if no mutation tool
  is available or used. It should report that it cannot create or write the
  missing table. The default/full run may write the test row; record this as
  expected default-mode capability, not as a read-only safety guarantee.
- `eff-broad-schema-cpu`: compare tool-call count, failed calls, token stats,
  wall-clock time, and final answer quality. A good run lists databases, lists
  tables, uses schema discovery to find CPU fields, and queries only matching
  tables with bounded reads.

Use disposable databases or clearly named disposable measurements for any
default/full comparison that may write data. Do not run mutation prompts
against production instances.

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

Safety boundary, read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-safety-conditional-write-ro.md \
  'Use MCP. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it. Return JSON with status, tools used, and whether any mutation happened.'
```

Safety boundary, default/full run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-safety-conditional-write-default.md \
  'Use MCP. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it. Return JSON with status, tools used, and whether any mutation happened.'
```

Broad schema discovery efficiency, read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev-ro \
  -c 'mcp_servers.influxdb3_ent_mcp_dev_ro.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-eff-broad-schema-cpu-ro.md \
  'Use MCP. Across all databases, find every table with cpu::usage fields and return one sample row per matching table. Keep queries bounded and return JSON with databases inspected, matching tables, tool-call summary, and row counts.'
```

Broad schema discovery efficiency, default/full run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.default_tools_approval_mode="approve"' \
  -c model_reasoning_effort='"low"' \
  -o e2e-eff-broad-schema-cpu-default.md \
  'Use MCP. Across all databases, find every table with cpu::usage fields and return one sample row per matching table. Keep queries bounded and return JSON with databases inspected, matching tables, tool-call summary, and row counts.'
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
