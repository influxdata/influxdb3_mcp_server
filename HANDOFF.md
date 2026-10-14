# Handoff: influxdb3_mcp_server#91 — accept `query` as an alias for `q`

- Task-id: `mcpserver-91`
- Issue: https://github.com/influxdata/influxdb3_mcp_server/issues/91
- Observed on: `influxdb3_mcp_server` `main` at `ba932f70eb5e1e4d84669471384648572c5acd46`
  (package version 1.4.2, zod 3.25.76). Original failure: testbench run
  `tb-eff-broad-schema-cpu-ent-default-claude`, 2026-07-30, server SHA
  `00fdb733278a09f8b7677a12f6fd818b9843c2d9`, Enterprise, default profile.
- Prepared in a private session on 2026-10-14. No product (InfluxDB) claims are
  involved: this is MCP-server-only behavior, so no claims-ledger entry is needed.

## Start from `main`, not `fix/query-routing-options`

The local branch `fix/query-routing-options` is 49 commits behind `main`. Its one
commit already landed on `main` as `00fdb73`. Branch fresh from `main`, e.g.
`jts/mcpserver-91-query-alias`.

## What the server does today

- `query_sql` and `query_influxql` share one argument schema in
  `src/tools/categories/query.tools.ts`: `readOnlyQueryInputSchema()` (JSON
  Schema sent to clients) and `readOnlyQueryZodSchema` (runtime validation).
  The query text is `q`; `db` and `q` are required; `additionalProperties: false`.
  Fixing the shared schema fixes both tools, which covers the issue's
  "also check `query_influxql`" item.
- The older `execute_query` tool in the same file uses `database` + `query`.
  So `query` isn't a model guess from nowhere: the server teaches both names.
  Don't change `execute_query` in this task.
- `src/server/index.ts` (the `CallToolRequestSchema` handler) runs
  `tool.zodSchema.parse(args)` **before** its `try` block. That has two effects:
  1. zod strips the unknown `query` key without comment, so the error says only
     "`q` Required", with no hint that `query` was received.
  2. A schema-validation failure is **never written to tool-call telemetry**
     (`logToolCall` runs only inside the `try`/`catch`). In the 2026-07-30 run,
     the failed call shows up in the agent transcript but not in
     `telemetry.jsonl`, so `telemetry_lines` < `tool_calls`.
- `McpTool.zodSchema` is typed `z.ZodSchema` (`src/tools/index.ts`), so a
  `z.preprocess(...)`/`ZodEffects` schema type-checks without widening the type.

## Planned fix

1. **Zod**: normalize before validating. If `q` is absent and `query` is a
   string, copy `query` into `q`. Keep `q` required after normalization. If both
   are sent, `q` wins. Handlers keep reading `args.q`, so no handler or service
   changes are needed.
2. **JSON Schema**: add a `query` string property described as an alias for `q`.
   Keep `q` as the documented primary name and describe it as "(alias: `query`)".
   Change `required` to `["db"]` so a client that validates before sending
   doesn't reject `{db, query}`. Keep `additionalProperties: false`.
   - **Don't use top-level `anyOf`/`oneOf`/`allOf`** to express "q or query".
     The Anthropic Messages API rejects tool `input_schema`s with those
     combinators at the top level, and other clients handle them unevenly.
     Enforce "one of them is present" in zod only.
3. **Error message**: if neither is present, fail with a message that names both
   (e.g. "Provide the query text in `q` (alias: `query`)") rather than zod's bare
   `Required` on `q`.
4. **Out of scope, worth a separate issue**: move validation inside the
   telemetry-logged path (or log validation failures with an `error_code` such as
   `invalid_arguments`), so failed calls show up in telemetry. Don't put this in
   the #91 PR unless the operator asks; it changes telemetry semantics that
   `tests/telemetry.test.ts` and the testbench compare tooling depend on.

Rejected alternative: renaming `q` → `query`. It breaks every existing client
and saved prompt that sends `q`, for no benefit over an alias.

## Required evals

### A. Deterministic tests (in the PR; no InfluxDB needed)

Add to `tests/query-routing.test.ts`, or a new `tests/query-args.test.ts`:

- For both `query_sql` and `query_influxql`, take the tool from
  `createQueryTools(stubService)`:
  - `zodSchema.parse({db, q})` → `q` set (unchanged behavior).
  - `zodSchema.parse({db, query})` → `q` equals the `query` value.
  - `zodSchema.parse({db, q: "A", query: "B"})` → `q === "A"`.
  - `zodSchema.parse({db})` throws, and the message mentions both `q` and `query`.
  - `zodSchema.parse({db, query: 42})` throws.
- The handler receives the normalized `q`: stub
  `InfluxDBMasterService`'s query method, call the handler with the parsed
  `{db, query}` args, and assert the service got the SQL text.
- In the JSON Schema `inputSchema`: `properties.query` exists, `required`
  deep-equals `["db"]`, and there is no top-level `anyOf`/`oneOf`/`allOf`.
- Protocol level, in `tests/protocol.test.ts` (spawns `build/index.js`):
  `tools/call` `query_sql` with `{db, query}` against the unreachable test target
  should fail with a **connection/query error, not a schema-validation error**.
  That proves the alias reached the handler. Mirror how the existing protocol
  tests drive tool calls; `EXPECTED_TOOL_COUNT` doesn't change.

Then run `npm run build && npm run lint && npm test`.

### B. Live check against the testbench (public session can do this)

Use the `influxdb-testbench` skill. Target Enterprise
`http://influxdb3-enterprise:8181` with `$INFLUXDB3_ENTERPRISE_SCOPED_TOKEN`.
Fixture: `host_system.metrics`, 2 rows timestamped 2026-01-01.

- Start the built server (readonly profile and default profile) and call
  `query_sql` with `{"db":"host_system","query":"SELECT * FROM metrics ORDER BY time DESC LIMIT 1","maxRows":1}`.
  Expect `success`, 1 row, and a telemetry line for the call.
- Repeat with `q`, then with `query_influxql` + `query`
  (`SELECT * FROM metrics LIMIT 1`). Expect the same result shape.

### C. Agent eval (record under `e2e-results/`, following the 2026-10-08 PR #128 pattern)

The original failure is **intermittent**: `eff-broad-schema-cpu` recorded
`failed_calls: 0` in every repeat of the 2026-09-08 and 2026-09-09 testbench
runs. An agent run therefore can't show the fix by "the error went away". Grade
it as a no-regression check plus a forced-path check:

1. **No-regression**: rerun `eff-broad-schema-cpu` (readonly and default) and
   `ro-happy-host-cpu`, using the runbook prompts in `AGENT_E2E_TESTS.md`
   verbatim, for Claude and Codex. Pass = same pass/fail as the baseline, no
   increase in tool calls, and telemetry lines == MCP calls.
2. **Forced alias path**: one Claude and one Codex run with an extra prompt,
   kept outside the runbook table:
   `Use MCP only. Do not inspect repository files. Do not edit files. Do not use shell commands. Call query_sql with arguments {"db":"host_system","query":"SELECT * FROM metrics ORDER BY time DESC LIMIT 1"} exactly as given, then return the row and query metadata as JSON.`
   Pass = first call succeeds, zero failed calls, final answer contains the row
   and metadata.
3. Write a `GRADING.md` plus a per-run directory (`prompt.txt`,
   `final-message.md`, `mcp-calls.json`, `telemetry.jsonl`, `grading.json`), as in
   `e2e-results/2026-10-08-pr128-query-rerun/`. Record the tested commit, the
   models, the target InfluxDB version (read it live; don't assume), and the
   secret-leak scan result.

### D. Host-side testbench run (operator; can't run from a public session)

Ask under `## Owed checks` in `/workspace/TASK.md`:

`- [ ] HANDOFF host: after the #91 PR head is pushed, vendor that SHA and run the MCP testbench with --case eff-broad-schema-cpu --case ro-happy-host-cpu --repeat 3, then compare against reports/testbench/2026-09-09-core-enterprise — expect: failed_calls 0 in all runs, success_rate unchanged, no tool_calls increase`

## Completion record (for the PR)

`not applicable: no generated content affected`. The change touches hand-written
TypeScript (`src/tools/categories/query.tools.ts`) and tests. Tool schemas are
built at runtime from that source; no generator or fetched spec is involved.
Docs to update: `README.md` line 46 (on `main`) tells agents to build a query
with `db`, `q`, and optional `params`. Add the `query` alias there.
`src/services/help.service.ts` doesn't name the argument.

## Acceptance

- `{db, query}` and `{db, q}` behave identically for `query_sql` and
  `query_influxql`; `q` wins when both are sent.
- An omitted query yields an error that names both `q` and `query`.
- The advertised `inputSchema` has no top-level combinators and accepts `query`.
- A–C pass and are recorded in the PR; D is requested from the operator.
- Close #91 from the PR. File the telemetry gap (validation failures not logged)
  as a separate issue.
