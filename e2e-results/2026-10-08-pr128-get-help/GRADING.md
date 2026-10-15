# PR #128 get_help grading report

Target: `ee8bc15003c911eb7acca1976205fa512501d029`. Date: 2026-10-08.

Eight completed runs: **two passed; six failed the overall-heading criterion**. All six cloud runs passed the language/tool mapping, tool-versus-endpoint distinction, server-owned routing, v1 `/query` endpoint, Flux-unsupported, and only-`get_help` criteria. All reported `=== QUERYING DATA ===` instead of `INFLUXDB 3 MCP SERVER HELP`.

| Case | Claude (`claude-opus-5-5`) | Codex (`gpt-5.6-sol`) | Calls per run |
| --- | --- | --- | --- |
| Cloud Serverless interpretation | Fail: overall heading | Fail: overall heading | 1 |
| Cloud Dedicated interpretation | Fail: overall heading | Fail: overall heading | 1 |
| Clustered interpretation | Fail: overall heading | Fail: overall heading | 1 |
| Enterprise InfluxQL recovery | Pass | Pass | 4 |

Both live recovery runs called `get_help → query_influxql → describe_table → query_influxql`. The literal `"cpu::usage*"` selector succeeded with zero rows, schema inspection found three CPU columns, and an InfluxQL regex query returned two fixture rows plus query metadata. Both reported the overall help heading and recognized that Flux is unsupported. No mutation or shell calls occurred in any completed run. Fourteen completed MCP calls matched fourteen telemetry entries; none returned tool errors. A zero-row response is not counted as an error.

The shared Enterprise instance reports version **3.11.5**, revision `6b5b62a42f18feb2d3054a501eea417bf94a96b3`, image `influxdb:3.11.5-enterprise`. The reused fixture rows are timestamped 2026-01-01. The instance was left running. The three cloud configurations use an unreachable local URL and a dummy token: these runs test help interpretation, not live cloud querying.

## Execution and authentication

Claude used its configured auth and default `claude-opus-5-5` model. Codex used **local ChatGPT OAuth**, with `OPENAI_API_KEY` and `CODEX_API_KEY` removed from the child environment and `--ignore-user-config`; successful runs explicitly selected `gpt-5.6-sol` with low reasoning. OAuth rejected `gpt-6.1-sol`, `gpt-6`, `gpt-6.1`, and `gpt-6-sol` before any MCP calls. These rejected attempts are not counted as completed evals. A preliminary sandboxed Codex launch failed to initialize its app-server, and a sandboxed Claude launch was interrupted during network retries; completed runs were launched outside that sandbox.

The isolated PR checkout was built with `npm run build` (passed). Each harness received the exact saved case prompt, the compiled PR server as its only MCP server, and the readonly tool profile. Claude disabled built-in tools; Codex used the read-only sandbox. Raw transcripts and launch metadata are retained locally under `/private/tmp/pr128-fresh-evals/`. Full Claude launch events are omitted from the PR because they can include MCP configuration credentials.

## Grading and evidence

Grading is an agent review against the saved prompts, returned MCP responses, final answers, and telemetry, with no separate model judge. Each run directory contains `prompt.txt`, `final-message.md`, `mcp-calls.json`, `telemetry.jsonl`, and `grading.json`. The companion JSON summary records identity, timing, available token usage, tool paths, per-criterion grades, and limitations.

The heading rubric follows the previous PR grading: it expects the overall heading. The cloud prompt says “exact help heading” without explicitly saying “overall,” which may contribute to the consistent section-heading answers. One repetition per case was run; the full agent eval suite was not rerun. These results establish targeted interpretation and Enterprise recovery behavior only.
