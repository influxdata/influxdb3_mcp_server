# Capability spec — `inspect_storage`: read-only operational visibility

- **Repo:** `influxdata/influxdb3_mcp_server`
- **Verified against:** `main` HEAD `4ab9849`, InfluxDB `3.11.0-0.rc.1`
- **Updated:** 2026-07-27
- **Status:** spec ready — **target: next 1.x release after 1.4.1, sign-off granted (F2/F3), see Governance**
- **Applies to:** InfluxDB 3 Enterprise on a PachaTree catalog (3.11+). Not Core.

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

| `aspect` | Answers |
|---|---|
| `overview` *(default)* | Shard count and total size, compaction backlog, age of the newest checkpoint, per-node ingest summary |
| `shards` | Per-shard storage — the "how much storage is each shard using" half of the impact map's example question |
| `compaction` | Compaction file state and whether compaction is keeping up — the other half |
| `snapshots` | Snapshot and checkpoint recency, for backup and restore posture |

`overview` alone should answer the impact map's example question — *"how much storage is each
shard using, and is compaction keeping up?"* — without a follow-up call. The other aspects
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

Schemas, stability guarantees, and required token scope are all unconfirmed; see questions
**C1–C5**. **C2 is a gate:** if these tables are internal and subject to change, a supported
capability cannot be built on them and this spec stops here.

## The prerequisite this forces: capability detection

This is the structurally interesting part, and it is worth more than the feature itself.

**The server performs no deployment or version detection today.** Three facts:

1. The product type is trusted verbatim from `INFLUX_DB_PRODUCT_TYPE`
   (`src/config.ts:41-42`). Nothing checks it against the instance.
2. `/ping` *does* return `x-influxdb-version` (`src/services/base-connection.service.ts:277-314`),
   but it is never parsed. Every consumer — `influxdb-master.service.ts:58-65`,
   `src/resources/index.ts:78-79`, `src/tools/categories/health.tools.ts:40,56` — passes the
   string straight through to output.
3. There is no list-time tool filtering. `src/server/index.ts:51-59` advertises all 22 tools
   unconditionally, whatever the product type. `validateOperationSupport()`
   (`src/services/base-connection.service.ts:210-252`) gates at **call** time only, so
   unsupported tools are advertised and then fail — precisely what the capability design
   forbids.

So this capability needs a small, cached **capability probe**:

- Parse the version from the `/ping` response already being fetched — no extra round trip.
- Probe for PachaTree with a bounded `SELECT … FROM system.pt_shards LIMIT 1`. Success means
  PachaTree; failure means Parquet or pre-3.11.
- Cache the result for the process lifetime. A deployment does not change engines mid-session.
- Advertise `inspect_storage` only on success.

The probe is deliberately reusable. It is the same "advertise only what works" mechanism the
capability design calls for generally, and the natural place to generalize PR #69's
`INFLUX_MCP_TOOL_PROFILE` allowlist — a static name list — into capability-driven filtering.
Built once here, it serves every later target that is Enterprise-shaped but incomplete.

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

`inspect_storage` is read-only and belongs in PR #69's `READONLY_TOOLS` set. If both land, the
tool should be available under the `readonly` profile — a natural fit, since "how is my server
doing?" is an investigation question, not an administrative one.

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

Blocking: **C1** (minimum sufficient token scope — narrowed but not resolved), **C2** (schema
stability — a hard gate), **B2** (sanctioned engine detection), **F2** (target release).
**B3** and **C4** are resolved — see above. Full list and rationale in
[`open-questions-core-enterprise.md`](open-questions-core-enterprise.md).
