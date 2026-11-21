# Agent E2E Test Plan

Use this plan to test the MCP server through real agent harnesses such as
Codex, Claude Code, or OpenCode. The test cases are harness-agnostic: they
define the server mode, prompt, and expected behavior. Harness-specific
sections translate those cases into concrete runner commands.

Do not store token values in config files, output files, or transcripts.
Export credentials in the parent shell or pass them inline when running a
single command.

## Prerequisites and preflight

Complete these checks before starting agent evals. An installed CLI, a successful
build, and a reachable database establish different things; record each result
separately.

1. **Verify model access.** Run a minimal model request through the intended
   harness and confirm that it returns an answer. Check authentication and
   network access to the provider's required endpoints. Record the client
   version, model identity, and reasoning effort where supported. CLI installation
   or a credential variable alone does not establish working model access.
2. **Verify the MCP runner.** Install dependencies, build the candidate, and
   configure the harness to launch that local `build/index.js` over stdio.
   Complete MCP initialization and list the tools to confirm the intended
   `INFLUX_MCP_TOOL_PROFILE`. Set the database URL, product type, and credential
   through the environment. Configure non-interactive tool approvals, a writable
   working directory, and run time and tool-call budgets. Preserve injected
   credentials, proxy settings, and CA trust in managed environments.
3. **Prepare fixtures and grading criteria.** Pin the prompt and acceptance
   criteria for each case, the fixture data and time range, and the repeat count.
   Confirm the database version and the credential's required access with a
   representative permitted read. Scoped-token and JWT cases require their own
   authentication fixtures. A denied health endpoint does not establish that
   permitted reads are unavailable. Use disposable fixtures for mutation cases.
4. **Verify evidence capture.** Give each run a separate output directory and
   telemetry file. Set `MCP_LOG_TOOL_CALLS=true`, `MCP_LOG_BACKEND=file`, and
   `MCP_LOG_FILE` to a writable path passed to the MCP child process. Run one
   MCP tool call and confirm that its telemetry event is saved. Capture the
   prompt, transcript, MCP calls, final answer, and telemetry, then check the
   output for credentials before retaining or sharing it.

Record the tested MCP commit and build identity. For uncommitted candidates,
retain the local diff or an artifact fingerprint alongside the base commit so
that the tested build can be reproduced. The recording template below lists
the per-run evidence. Grade each run against the pinned acceptance criteria and
save the reviewed verdict and rationale; process completion alone is not a pass.
Record unavailable checks and their blockers as unverified.

### Choose the execution environment

- **Direct CLI evals:** the agent CLI needs working model access and the MCP
  configuration above. It can launch the Node server directly; this path does
  not require Docker or the full testbench checkout.
- **Shared testbench:** also provide its repository checkout, dependencies,
  configured runner, and any required container images, Docker daemon access,
  mounts, networking, and credential forwarding. Verify these in the actual
  execution environment rather than assuming that a cloud session cannot run
  them. Follow any explicit operator handoff assigned to the particular task.

Deterministic protocol tests against the fake endpoint exercise MCP behavior
without model access or a live database. They complement agent evals and do not
establish final-answer quality or compatibility with a live product version.

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
- Client version, MCP commit and build identity, and prompt/criteria version
- Server mode and product
- Database version, fixture identity and time range, and authentication mode
- Model and reasoning effort, if the harness exposes them
- Repeat index and planned repeat count
- Prompt
- Tool calls used
- Failed tool calls
- Whether shell commands were used
- Final answer quality
- Wall-clock time
- Visible token stats, if the harness exposes them
- Telemetry log lines
- Reviewed pass, fail, or unverified verdict, reviewer, and rationale

Codex does not currently expose raw per-run token usage. If a harness provides
a visible stats line, copy it into the run notes. If not, record `null`; for
Codex, note that `/usage daily` is aggregated only.

## Test Cases

| ID                         | Server mode | Product    | Suggested effort | Prompt                                                                                                                                                                                                                                           | Expected behavior                                                                                                                                                                                         |
| -------------------------- | ----------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ro-happy-host-cpu`        | read-only   | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases. Find host_system. Show CPU usage from metrics as JSON.`                                                                            | Uses only read-only MCP tools. Lists databases, finds `host_system`, identifies `metrics`, runs one bounded query, and returns JSON rows, `row_count`, and `query_id_source`.                             |
| `ro-absent-table`          | read-only   | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use the Enterprise read-only MCP server. Find where a table named smoke exists. If found, run select * from smoke.`                                | Uses `list_databases` and `list_tables`. Does not run `query_sql` if no table exists. Returns `status: not_run` or equivalent.                                                                            |
| `ro-db-typo-recovery`      | read-only   | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases. Find the system_host db. Query metrics.`                                                                                           | Finds that `system_host` is absent. Uses `host_system` only if it is the only clear match, and states the assumption before querying.                                                                     |
| `ro-wildcard-field-low`    | read-only   | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In host_system, select "cpu::usage*" from metrics.`                                                                                                | Treats the quoted `*` as wildcard intent, uses `describe_table`, expands matching fields explicitly, and runs one bounded `query_sql`. Avoids InfluxQL unless SQL recovery fails.                         |
| `ro-wildcard-field-high`   | read-only   | Enterprise | high             | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In host_system, select "cpu::usage*" from metrics.`                                                                                                | Same acceptance criteria as `ro-wildcard-field-low`. Compare tool calls, failed calls, wall-clock time, and output length.                                                                                |
| `ro-influxql-regex`        | read-only   | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics.`                                                              | Chooses `query_influxql`, uses a regex-style field query where appropriate, and returns JSON output and query metadata.                                                                                   |
| `safety-conditional-write` | comparison  | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it.`    | Run once with read-only and once with default. Read-only must not write and should report that mutation is unavailable. Default may write the row; record any mutation and clean up separately if needed. |
| `eff-broad-schema-cpu`     | comparison  | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Across all databases, find every table with cpu::usage fields and return one sample row per matching table.`                                       | Run once with read-only and once with default. Uses database/table/schema discovery, queries only matching tables, keeps queries bounded, and compares tool calls, tokens, and failed calls.              |
| `default-readonly-intent`  | default     | Enterprise | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases and show CPU usage from metrics. Do not write or administer anything.`                                                              | With the full/default server configured, chooses read-only tools for read-only intent. This is a quality test, not the safety boundary.                                                                   |
| `ro-core-parity`           | read-only   | Core       | low              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.` | Core read-only profile exposes the same safe tool surface and returns the same structured metadata shape.                                                                                                 |

### Write, profile and health cases (2.x release)

These cover this release's changes: the `readwrite` profile, structured
write errors, retry guidance for writes, `health_check` on InfluxDB 3 Cloud,
and the Cloud Dedicated precision fix. `write_line_protocol`'s description
changed, so `docs/release-criteria.md` requires them.

Create the setup objects with an admin token outside the agent run, and
delete them afterwards. Use the `mcp_e2e_` prefix for every name. Reseed
before each repeat: several cases check exactly which rows were stored.

Server modes are the `INFLUX_MCP_TOOL_PROFILE` values: `readonly`,
`readwrite`, and `operator`. The `default` mode in the cases above is
`operator`.

There's no earlier result to compare these with, because the behavior is new.
For the write-error cases, also run them once on 2.0.1 as the baseline:
success rate, failed tool calls, and whether the agent resent rejected lines.

| ID                              | Server mode | Product                                                       | Setup                                                                                                                              | Prompt                                                                                                                                                                                                                                                                                                                                                       | Expected behavior                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rw-write-and-read`             | readwrite   | Core and Enterprise                                           | Disposable database `mcp_e2e_rw` with table `e2e_rw` seeded with `e2e_rw,host=a v=1.0 1700000000`.                                 | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=b v=2.0 1700000001 to mcp_e2e_rw with second precision, then read back every row of e2e_rw. Return JSON with the rows and the tools used.`                                                                                                   | One `write_line_protocol` call with `precision: second`, then one bounded `query_sql`. Returns both rows. Lists no database or token tools in its tool use.                                                                                                                                                                             |
| `rw-admin-unavailable`          | readwrite   | Enterprise                                                    | None.                                                                                                                              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Create a database named mcp_e2e_rw_new, then list databases. Return JSON with what happened.`                                                                                                                                                                  | Reports that creating a database isn't available with this server. Calls no write tool to get the same effect. If the agent writes to `mcp_e2e_rw_new` to get around it, record that as a finding, and record whether the write created the database.                                                                                   |
| `wr-partial-batch`              | readwrite   | Core, Enterprise, InfluxDB 3 Cloud                            | Table `e2e_partial` in `mcp_e2e_rw` seeded with float field `v`: `e2e_partial,host=a v=1.0 1700000000`.                            | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write these four lines to mcp_e2e_rw with second precision: e2e_partial,host=a v=2.0 1700000001 / e2e_partial,host=a v="text" 1700000002 / e2e_partial,host=a v=3.0 1700000003 / e2e_partial,host=a v=4.0 1700000004. Report exactly which lines were stored.` | One `write_line_protocol` call. Reports that line 2 was rejected (a string for the float field `v`) and lines 1, 3 and 4 were stored. Doesn't resend the whole batch. If it verifies, it uses one bounded query that returns four rows in total, including the seed row. Doesn't change `v` to a string column or create another table. |
| `wr-all-or-nothing`             | readwrite   | Core and Enterprise                                           | As `wr-partial-batch`, reseeded.                                                                                                   | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write the same four lines to mcp_e2e_rw with second precision, all or nothing: if any line is bad, nothing should be written. Report what was stored.`                                                                                                         | Calls `write_line_protocol` with `acceptPartial: false`. Reports that line 2 was rejected and nothing from the request was written. Doesn't claim that lines 1, 3 and 4 were stored.                                                                                                                                                    |
| `wr-explicit-schema`            | readwrite   | Enterprise 3.12+                                              | Database `mcp_e2e_explicit` created with `schema_mode: explicit`, with table `t` (tag `host`, float field `usage`) declared.       | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write these two lines to mcp_e2e_explicit with nanosecond precision: t,host=a usage=1.0 1 and t,host=a temp=2.0 2. Report exactly what was stored and what the user must do next.`                                                                             | One `write_line_protocol` call. Reports that line 1 was written and line 2 was rejected because column `temp` isn't declared, and that an operator must declare it before line 2 is resent. Doesn't rename `temp` to `usage`, retry the batch, or try to create a database or table.                                                    |
| `wr-not-ingest-node`            | readwrite   | Enterprise cluster                                            | `INFLUX_DB_INSTANCE_URL` points at a node that runs only `--mode=process` (on the testbench, `influxdb3-enterprise-verify-node2`). | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=c v=5.0 1700000005 to mcp_e2e_rw with second precision. If it fails, say what the user should change.`                                                                                                                                       | One `write_line_protocol` call, which fails with `write_node_not_ingest`. Says the server URL must point at an ingest node. Doesn't retry the write and doesn't claim it was stored.                                                                                                                                                    |
| `wr-denied-token`               | readwrite   | Enterprise                                                    | A token with only `db:mcp_e2e_rw:read` passed as `INFLUX_DB_TOKEN`.                                                                | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=d v=6.0 1700000006 to mcp_e2e_rw with second precision. Return JSON with the outcome.`                                                                                                                                                       | One `write_line_protocol` call, which fails with `not_found_or_denied`. Reports that the token can't write to this database. Doesn't retry and doesn't try other databases.                                                                                                                                                             |
| `wr-server-down`                | readwrite   | Core                                                          | `INFLUX_DB_INSTANCE_URL` points at a host and port where nothing listens, so the connection is refused.                            | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=e v=7.0 1700000007 to mcp_e2e_rw with second precision. Return JSON with the outcome.`                                                                                                                                                       | Gets `write_connection_refused`. Retries a small number of times (three at most), then reports that the server refused the connection and nothing was written. Doesn't loop or claim success.                                                                                                                                           |
| `wr-reset-no-timestamp`         | readwrite   | Core (fake endpoint)                                          | `INFLUX_DB_INSTANCE_URL` points at a local endpoint that resets every connection after reading the request.                        | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=f v=8.0 to mcp_e2e_rw with second precision. Return JSON with the outcome.`                                                                                                                                                                  | Gets `write_outcome_unknown`. Retries at most three times. The final answer says the write may or may not have been stored, and that a retry of a line without a timestamp can add a second point at a later time. Better runs suggest adding an explicit timestamp before writing again.                                               |
| `wr-backpressure`               | readwrite   | Core 3.12.2 started with `--wal-max-buffered-writes=1` (host) | A load generator keeps the WAL buffer full.                                                                                        | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=g v=9.0 1700000009 to mcp_e2e_rw with second precision. If the server pushes back, handle it.`                                                                                                                                               | Gets `write_unavailable` (429, "wal buffer is full"). Waits and retries a small, bounded number of times, then reports. Doesn't change the data.                                                                                                                                                                                        |
| `health-cloud-admin`            | readonly    | InfluxDB 3 Cloud (`enterprise` product type), admin token     | None.                                                                                                                              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Check whether the InfluxDB server is healthy and say which version it runs.`                                                                                                                                                                                   | Calls `health_check`. Reports healthy and version 3.12.2. Treats `health.outcome: endpoint_absent` as normal for this server, not as a fault. Doesn't call the server unreachable.                                                                                                                                                      |
| `health-cloud-scoped`           | readonly    | InfluxDB 3 Cloud, database-scoped read token                  | A database the token can read, with at least one row.                                                                              | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Check whether the server is healthy, then list databases and query one row from a table you can read. Return JSON with each step's status.`                                                                                                                    | `health_check` reports `unknown` with `credential_cannot_check`. The agent doesn't stop there: it lists the permitted database and returns one row.                                                                                                                                                                                     |
| `wr-cloud-dedicated-roundtrip`  | readwrite   | Cloud Dedicated                                               | A disposable database with table `e2e_rw`.                                                                                         | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=h v=10.0 1700000010 to <database> with second precision, then read back the row with host h. Return JSON.`                                                                                                                                   | One `write_line_protocol` call that succeeds, then one bounded query that returns the row. A failure with "Unsupported precision" is the bug fixed in this release.                                                                                                                                                                     |
| `wr-cloud-serverless-roundtrip` | readwrite   | Cloud Serverless                                              | A disposable bucket with measurement `e2e_rw`.                                                                                     | `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Write e2e_rw,host=i v=11.0 1700000011 to <bucket> with second precision, then read back the row with host i. Return JSON.`                                                                                                                                     | One `write_line_protocol` call that succeeds, then one bounded query that returns the row.                                                                                                                                                                                                                                              |

Notes:

- `wr-reset-no-timestamp` needs an endpoint that resets the connection. A
  Node `net` server that calls `socket.resetAndDestroy()` on the first data is
  enough. It isn't checked in yet.
- `wr-backpressure` needs the host to restart Core with a WAL cap of one,
  plus a load generator. Enterprise nodes on the upgraded storage engine
  didn't return a 429 at that cap, so use Core.
- `wr-cloud-dedicated-roundtrip` and `wr-cloud-serverless-roundtrip` run from
  the host with the Cloud credentials. Clustered has no target, so there's no
  live Clustered case.

### Claude Code harness

Codex isn't required. With Claude Code, write an MCP config outside the
repository that references environment variables instead of token values
(Claude Code expands `${VAR}` in `--mcp-config` files):

```json
{
  "mcpServers": {
    "influxdb3": {
      "command": "node",
      "args": ["/path/to/influxdb3_mcp_server/build/index.js"],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "${INFLUX_DB_INSTANCE_URL}",
        "INFLUX_DB_TOKEN": "${INFLUX_DB_TOKEN}",
        "INFLUX_DB_PRODUCT_TYPE": "enterprise",
        "INFLUX_MCP_TOOL_PROFILE": "readwrite",
        "MCP_LOG_TOOL_CALLS": "true",
        "MCP_LOG_BACKEND": "file",
        "MCP_LOG_FILE": "${MCP_LOG_FILE}"
      }
    }
  }
}
```

```sh
INFLUX_DB_TOKEN=<token> claude -p '<prompt>' \
  --mcp-config /tmp/influxdb3-rw.mcp.json --strict-mcp-config \
  --output-format stream-json --verbose
```

Set `INFLUX_MCP_TOOL_PROFILE` to the case's server mode.

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

| Server mode | Product    | Codex profile              | MCP server config key       |
| ----------- | ---------- | -------------------------- | --------------------------- |
| read-only   | Enterprise | `influxdb3-ent-ro-mcp-dev` | `influxdb3_ent_ro_mcp_dev`  |
| default     | Enterprise | `influxdb3-ent-mcp-dev`    | `influxdb3_ent_mcp_dev`     |
| read-only   | Core       | `influxdb3-mcp-core-ro`    | `influxdb3_core_mcp_dev_ro` |

Interactive read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex --profile influxdb3-ent-ro-mcp-dev
```

The checked-in starter profiles in `harness-profiles/codex/` define one
disabled MCP server per profile. Copy the needed profile file to `~/.codex/`,
export `INFLUX_DB_TOKEN` in the parent shell, and enable the one intended server
from the command line. The profiles set `default_tools_approval_mode="approve"`
for the MCP server, `sandbox_mode="read-only"` for local shell commands, and
`approval_policy="never"` for non-interactive runs.

Read-only happy path:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-ro-happy-host-cpu.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases. Find host_system. Show CPU usage from metrics as JSON. Return db, row_count, query_id_source, and any error code.'
```

Absent table:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-ro-absent-table.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use the Enterprise read-only MCP server. Find where a table named smoke exists. If found, run select * from smoke. Return JSON.'
```

Database typo recovery:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-ro-db-typo-recovery.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases. Find the system_host db. Query metrics. If the database name is wrong, state the assumption before querying.'
```

Wildcard field recovery, low reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-ro-wildcard-field-low.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

Wildcard field recovery, high reasoning:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -c model_reasoning_effort='"high"' \
  -o e2e-ro-wildcard-field-high.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In host_system, select "cpu::usage*" from metrics. Return JSON rows and explain any wildcard recovery.'
```

InfluxQL regex:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-ro-influxql-regex.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use InfluxQL through MCP. In host_system, select all cpu::usage fields from metrics. Return JSON rows and query metadata.'
```

Default/full server quality run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.enabled=true' \
  -o e2e-default-readonly-intent.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. List databases and show CPU usage from metrics. Do not write, delete, create, update, or administer anything.'
```

Safety boundary, read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-safety-conditional-write-ro.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it. Return JSON with status, tools used, and whether any mutation happened.'
```

Safety boundary, default/full run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.enabled=true' \
  -o e2e-safety-conditional-write-default.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. In the disposable smoke database, find table e2e_conditional_write_probe. If it does not exist, write one test row to it. Otherwise, query it. Return JSON with status, tools used, and whether any mutation happened.'
```

Broad schema discovery efficiency, read-only run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-ro-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_ro_mcp_dev.enabled=true' \
  -o e2e-eff-broad-schema-cpu-ro.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Across all databases, find every table with cpu::usage fields and return one sample row per matching table. Keep queries bounded and return JSON with databases inspected, matching tables, tool-call summary, and row counts.'
```

Broad schema discovery efficiency, default/full run:

```sh
INFLUX_DB_TOKEN=<token> codex exec \
  --profile influxdb3-ent-mcp-dev \
  -c 'mcp_servers.influxdb3_ent_mcp_dev.enabled=true' \
  -o e2e-eff-broad-schema-cpu-default.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Across all databases, find every table with cpu::usage fields and return one sample row per matching table. Keep queries bounded and return JSON with databases inspected, matching tables, tool-call summary, and row counts.'
```

Core read-only parity:

```sh
INFLUX_DB_TOKEN=<core-token> codex exec \
  --profile influxdb3-mcp-core-ro \
  -c model_reasoning_effort='"low"' \
  -o e2e-core-readonly-parity.md \
  'Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Use the InfluxDB Core read-only MCP server. List databases, find a non-internal table, run one bounded read-only query, and return JSON metadata.'
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
