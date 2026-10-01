# Capability spec — `inspect_storage`: read-only operational visibility

- **Repo:** `influxdata/influxdb3_mcp_server`
- **Verified against:** `main` HEAD `249f612` (version `1.4.1-test.1`), InfluxDB `3.11.0` GA
  (was `3.11.0-0.rc.1`; see `verification-questions.md` E1)
- **Updated:** 2026-08-06
- **Status:** spec ready — **target: next 1.x release after 1.4.1, sign-off granted (F2/F3), see Governance**
- **Applies to:** InfluxDB 3 Enterprise on a PachaTree catalog (3.11+). Not Core.
- **Open from live verification (2026-08-06, not yet folded into this spec's body):** the live
  schema dump found **12** `pt_*` tables, not the 10 below — `pt_ingest_wal` and
  `pt_ingest_files` exist and aren't in the aspect-to-table mapping yet. Token scope (C1) is
  narrower than assumed in the guardrail language below: a plain per-database read token was
  sufficient in testing, no `system:*:read`/admin/operator token required. Full detail in
  `verification-questions.md` §3/§4 (C2, C1). The stability gate (C2, Needs Engineering) is
  still open and is what determines whether the table list below can be trusted long-term.

## Why this capability, and why now

The v1.0 companion brief proposed a read-only "how is my server doing?" capability but could
not justify it: system state was not reliably queryable. 3.11 changes that. Impact map §4
records the move from "unverified" to "feasible on 3.11+ Enterprise", on the strength of five
new system tables that expose shards, compaction files, snapshots, and checkpoints.

It is the right first new capability on three counts. It is read-only, so it carries the
lowest risk of the candidates. It is Core/Enterprise-scoped. And it produces the usage
evidence — task success rate, response time, tokens per completed task — that the brief makes
the whole strategy depend on.

## Shape: one capability, not five table mirrors

The brief's first principle is capabilities over API mirrors: a tool organized around what the
user is trying to do, not one tool per endpoint. Five tools mapping to five system tables
would be the mirror anti-pattern, and would force the model to sequence them correctly.

**One tool, `inspect_storage`, with an `aspect` enum:**

| `aspect`               | Answers                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `overview` _(default)_ | Shard count and total size, compaction backlog, age of the newest checkpoint, per-node ingest summary    |
| `shards`               | Per-shard storage — the "how much storage is each shard using" half of the impact map's example question |
| `compaction`           | Compaction file state and whether compaction is keeping up — the other half                              |
| `snapshots`            | Snapshot and checkpoint recency, for backup and restore posture                                          |

`overview` alone should answer the impact map's example question — _"how much storage is each
shard using, and is compaction keeping up?"_ — without a follow-up call. The other aspects
exist for when the model needs to drill in.

**Returns a summarized digest, not raw rows.** Computed answers ("compaction is ~4 minutes
behind across 12 shards"), with the supporting figures attached. Dumping four system tables
into the context window is the failure mode to design against.

### Backing tables

New in 3.11 per the release notes: `system.pt_shards`, `system.pt_compaction_files`,
`system.pt_storage_snapshots`, `system.pt_storage_checkpoints`,
`system.pt_storage_run_set_indexes`.

**Correction (2026-08-05): this list understates the surface.** The Enterprise admin docs
(`admin/query-system-data/#query-storage-engine-tables`) document five more compaction-specific
tables not named in the release notes or the original version of this spec:
`system.pt_compaction_active_jobs` (running jobs), `system.pt_compaction_ingest_nodes`
(per-node `compaction_lag` — directly answers C4, see below), `system.pt_compaction_nodes`
(compaction node state), `system.pt_compaction_run_sets` (pending work by time window/shard),
and `system.pt_compaction_deferred_snapshots` (snapshots stuck failing to compact —
`error_message` explains why). The `compaction` aspect below needs these, not just
`pt_compaction_files`.

Also `pt_ingest_wal` and `pt_ingest_files`, which gained `node_id` and `node_name` columns in
3.11 — that is what makes a per-node breakdown possible.

This ten-table list is assembled from release notes plus admin docs, not from an instance.
Rebuild it from the `information_schema` dump in
[`verification-questions.md`](verification-questions.md) §3 (C2's observable half) before
finalizing the aspect-to-table mapping above.

Schemas, stability guarantees, and required token scope are all unconfirmed; see questions
**C1–C5**. **C2 is a gate:** if these tables are internal and subject to change, a supported
capability cannot be built on them and this spec stops here.

## The prerequisite this forces: capability detection

This is the structurally interesting part, and it is worth more than the feature itself.

**The server performs no deployment or version detection today.** Three facts:

1. The product type is trusted verbatim from `INFLUX_DB_PRODUCT_TYPE`
   (`src/config.ts:41-42`). Nothing checks it against the instance.
2. `/ping` _does_ return `x-influxdb-version` (`src/services/base-connection.service.ts:277-314`),
   but it is never parsed. Every consumer — `influxdb-master.service.ts:58-65`,
   `src/resources/index.ts:78-79`, `src/tools/categories/health.tools.ts:40,56` — passes the
   string straight through to output.
3. There is no **capability-based** list-time filtering. `ListToolsRequestSchema`
   (`src/server/index.ts:94-99`) advertises whatever `createTools()` returns — all 27 tools,
   whatever the product type and whatever the instance actually supports. The one filter that
   exists, `INFLUX_MCP_TOOL_PROFILE` (`src/tools/index.ts:57-61`), is a static name list set
   by the operator, not a probe of the instance. `validateOperationSupport()`
   (`src/services/base-connection.service.ts:218`) gates at **call** time only, so unsupported
   tools are advertised and then fail — precisely what the capability design forbids.

So this capability needs a small, cached **capability probe**:

- Parse the version from the `/ping` response already being fetched — no extra round trip.
- Probe for PachaTree with a bounded `SELECT … FROM system.pt_shards LIMIT 1`. Success means
  PachaTree; failure means Parquet or pre-3.11.
- Cache the result for the process lifetime. A deployment does not change engines mid-session.
- Advertise `inspect_storage` only on success.

The probe is deliberately reusable. It is the same "advertise only what works" mechanism the
capability design calls for generally, and the natural place to generalize the shipped
`INFLUX_MCP_TOOL_PROFILE` allowlist (`src/tools/index.ts:28,57-61`) — a static name list — into
capability-driven filtering. Built once here, it serves every later target that is
Enterprise-shaped but incomplete, InfluxDB 3 Cloud support included (see F3).

**Design constraint:** the probe must be cheap and must fail closed. A failed probe hides the
tool; it must never block startup or degrade `health_check`.

## Behavior and guardrails

- **Enterprise on PachaTree only.** Hidden — not failing — on Core, on Parquet Enterprise, and
  on pre-3.11 Enterprise. No tool is advertised that cannot work.
- **Hybrid migrations.** RESOLVED (B3) — the Enterprise admin docs document
  `system.upgrade_parquet_node` (per-node status) and `system.upgrade_parquet` (per-file
  progress) specifically for this state. Query these directly to report migration state; "confirm
  each node reaches `completed`" is the documented check. No inference from `pt_*` presence
  needed.
- **Read-only, minimum sufficient permissions.** Query permission only, no operator token.
  What "minimum sufficient" means is still open (**C1**): an admin token can always read these
  tables, but the docs don't state whether an ordinary database token suffices or whether a
  `system:<endpoint>:read`-scoped resource token is required for `pt_*` specifically — that
  distinction is documented for `system.tokens` but not for these tables. Confirm with a
  scoped, non-admin token before finalizing the guardrail language here; never returns token
  values regardless.
- **Bounded output.** Hard row caps and an explicit result limit, so a large cluster cannot
  exhaust the model's context. State the cap in the response when it truncates rather than
  silently dropping rows.
- **No LoadCapture.** The impact map notes LoadCapture data pairs naturally with this
  capability once public. Until its guide publishes and Support confirms capacity, neither the
  server nor the skill may mention it. Note it on the backlog, not in the tool.

## Interaction with the read-only profile

The read-only profile is **already shipped** — PR #69 merged and released in 1.4.0. On `main`
today, `READONLY_TOOLS` is a static name `Set` (`src/tools/index.ts:28`) filtered by
`INFLUX_MCP_TOOL_PROFILE` (`:57-61`, validated in `src/config.ts:55`).

So this is not a "if both land" question. `inspect_storage` is read-only and its name goes
into that existing set when it's implemented — a natural fit, since "how is my server doing?"
is an investigation question, not an administrative one. Adding it is one line plus a bump to
`EXPECTED_TOOL_COUNT` (`tests/protocol.test.ts:7`, currently 27).

The capability probe below is the generalization of that static set: the same "advertise only
what works" mechanism, driven by what the instance can actually do rather than by a hardcoded
name list.

## Governance — resolved, 2026-08-05

**F2 and F3 are both decided.** `inspect_storage` remains this plan's new capability (F3) and
is admitted on the 1.x line with sign-off (F2) — not deferred to 2.0. Sequencing: it ships as
the next 1.x release **after** 1.4.1. The patch (P1–P7) fixes live defects against an
already-released InfluxDB version and has no open decisions blocking it; `inspect_storage` is
new work with no external deadline, so it queues behind the patch rather than competing with it
for release-branch attention.

The freeze (release plan workstream 4) otherwise admits only critical fixes, 3.11
compatibility, and InfluxDB 3 Cloud support (its own future plan, see F3). Workstream 2's
guardrail names storage-engine introspection as post-migration backlog by default — this
sign-off is the explicit exception to that, not a reinterpretation of it.

**Still blocking before implementation can start:** C1 (minimum sufficient token scope) and C2
(schema stability — a hard gate). Sequencing after 1.4.1 buys time for those to be answered
without holding up the patch.

The capability-detection work is a different matter. It is needed by any target that is
Enterprise-shaped but incomplete, and that need arrives on its own schedule regardless of when
`inspect_storage` ships.

## Open questions

Full list, with the exact checks to run, in
[`verification-questions.md`](verification-questions.md). What gates this spec:

| ID     | Question                                                                      | How it's answered                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C2** | Are the `pt_*` schemas public and stable?                                     | **Hard gate, Engineering only.** Today's schemas are observable (§3) but a stability commitment is not. If internal, this spec stops here.             |
| **C1** | Minimum token scope that can read `pt_*`                                      | **Testable** (§4) — three scoped tokens against one `SELECT`. Decides whether the "query permission only, no operator token" guardrail above survives. |
| **C3** | Do `pt_*` appear in `information_schema.columns`, under which `table_schema`? | **Testable** (§3). Also decides C5's fallback probe.                                                                                                   |
| **C5** | Core's failure mode for a `pt_*` query — error or empty success?              | **Testable** (§3). An empty 200 breaks the probe's fail-closed design.                                                                                 |
| **B1** | Is `x-influxdb-version` guaranteed and stably formatted?                      | **Testable** (§3), except for what GA reports.                                                                                                         |
| **B2** | Sanctioned engine detection over HTTP                                         | **Half testable** (§3) — which probes work is observable; which is _supported_ is an Engineering question.                                             |

**F2** is resolved (target release settled, see Governance above) and is no longer an open
question. **B3** and **C4** are resolved — see above.
