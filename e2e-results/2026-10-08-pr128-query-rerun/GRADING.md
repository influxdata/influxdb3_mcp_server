# PR #128 query eval rerun

Date: 2026-10-08. Tested commit: `626ff257f1d91594d1475dbfb80a71f7bd63f80c`, based on PR head `bbd07bc316f9725f5c501a50275ddccba4854834`, including the Cloud Serverless InfluxQL routing fix and regression tests.

Twelve completed runs, one repetition per case and harness: **four passed the full rubric; eight failed answer criteria**. All six live query runs returned the expected two CPU fixture rows. The failures concern answer completeness, not failed query execution.

| Case | Claude (`claude-opus-5-5`) | Codex (`gpt-5.6-sol`, low reasoning) |
| --- | --- | --- |
| Cloud Serverless help interpretation | Fail: overall heading | Fail: overall heading |
| Cloud Dedicated help interpretation | Fail: overall heading | Fail: overall heading |
| Clustered help interpretation | Fail: overall heading | Fail: overall heading |
| Help plus live InfluxQL recovery | Pass | Pass |
| Live SQL wildcard expansion (`ro-wildcard-field-low`) | Pass | Pass |
| Live InfluxQL regex (`ro-influxql-regex`) | Fail: JSON output and query metadata omitted | Fail: query metadata omitted |

## Observed behavior

All six cloud runs called only `get_help`. They correctly distinguished SQL/InfluxQL MCP tool names from HTTP endpoint paths, assigned routing to the MCP server, identified `/query` for their configured product, and recognized that Flux is unsupported. All returned `=== QUERYING DATA ===` instead of the overall `INFLUXDB 3 MCP SERVER HELP` heading. These are help interpretation checks, not live cloud queries.

Both recovery runs used `get_help → query_influxql → describe_table → query_influxql`. The initial literal `"cpu::usage*"` selection succeeded with zero rows. Schema inspection identified the three CPU fields; regex recovery returned two rows with query metadata. Both final answers included JSON rows, metadata, the overall help heading, and Flux-unsupported guidance.

Both SQL wildcard runs inspected the schema and selected explicit CPU fields with one bounded SQL query; neither called InfluxQL. Claude used `describe_table → query_sql`, selecting time and host alongside the CPU fields with `LIMIT 100`. Codex used `load_database_context → list_databases → describe_table → query_sql`; it supplied `maxRows=1000`, and the server appended `LIMIT 1000` before execution. Both returned the two fixture rows.

Both standalone InfluxQL regex runs used one `query_influxql` call with regex field selection and returned two rows. Claude's final answer used a Markdown table and omitted query metadata. Codex returned JSON rows, database, row count, and truncation status, but omitted the returned request/query identifiers and `query_id_source`. The complete tool responses are saved separately and do include query metadata.

Twenty-two MCP calls matched twenty-two telemetry entries. No tool calls returned errors, no shell commands were executed by the eval agents, and no mutation tools were called. Initial zero-row selections are successful tool responses, not errors.

## Target and execution

Live target: reused shared `influxdb3-enterprise`, image `influxdb:3.11.5-enterprise`, version **3.11.5**, revision `6b5b62a42f18feb2d3054a501eea417bf94a96b3`, localhost port 8181. The `host_system.metrics` fixture has two rows timestamped 2026-01-01. The instance was left running. No Core target was running.

Claude used configured auth and its default `claude-opus-5-5` model. Codex explicitly used `gpt-5.6-sol` with low reasoning and **local ChatGPT OAuth**; `OPENAI_API_KEY` and `CODEX_API_KEY` were removed from the child environment, and `--ignore-user-config` was used. Each harness had the compiled server from the tested checkout as its only MCP server, with the readonly profile. Claude disabled built-in tools; Codex used its read-only sandbox. Runs were executed sequentially. Cloud help targets used an unreachable local URL and a dummy token.

Before evals: `npx vitest run tests/query-routing.test.ts tests/query-error-serverless.test.ts tests/query-error-core.test.ts tests/query-safety.test.ts` passed **35 tests**; `npm run build` passed. All saved JSON/JSONL parsed successfully; telemetry counts and a secret-leak scan passed. Full launch transcripts remain local under `/private/tmp/pr128-query-rerun/`; credential-bearing Claude launch configuration is excluded from committed evidence.

## Grading limits and artifacts

Grades are an agent review against the saved prompts, the runbook's expected behavior, final answers, actual MCP responses, and telemetry; no separate model judge ran. Each run directory contains the exact prompt, final answer, tool-call evidence, telemetry, and per-criterion grading. The companion JSON summary records model, auth, target commit, timing, available usage, tool paths, and grades.

The heading rubric follows the earlier PR report and expects the overall heading, although the unchanged cloud prompts ask only for the “exact help heading.” The runbook expects JSON and query metadata for `ro-influxql-regex`, although its table prompt does not explicitly request these output details. Those prompt/rubric mismatches limit what the answer failures establish. No full eval suite, live cloud query, or explicit Core/Enterprise v1-compatibility selection was tested; the latter feature remains tracked in #129.
