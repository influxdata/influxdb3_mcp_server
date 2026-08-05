# Open questions — InfluxDB 3 Core and Enterprise

- **Updated:** 2026-07-27
- **Status:** ready to send
- **Context:** MCP server 3.11 patch and the `inspect_storage` capability. See
  [`PLAN.md`](PLAN.md).

Twenty questions. Each is a genuine gap — something neither the three planning drafts nor the
3.11 internal release notes answer, and that reading the MCP server code cannot settle. Items
the code *did* settle are recorded in [`PLAN.md`](PLAN.md) and are not repeated here.

**Blocking** means work stops without an answer. **Non-blocking** means the work proceeds and
the answer refines it.

| Group | Owner | Blocks |
|---|---|---|
| A — Write path and error surface | Core/Enterprise write path | The patch |
| B — Version and engine detection | Core/Enterprise platform | Both deliverables |
| C — System tables | Enterprise storage / PachaTree | The capability |
| D — Authentication and tokens | Enterprise auth | Patch item P5; the migration |
| E — Test environment | Release engineering | The test matrix |
| F — Release governance | Whoever owns the freeze | Sequencing |

---

## A. Write path and error surface

**A1. Does `POST /api/v3/write_lp` return 503 for a stopped node, as `/api/v2/write` now
does?** *(Blocking — patch item P3.)*
The 3.11 notes document the change only for the v2 API. Core and Enterprise use v3
exclusively, so as written the change does not reach them. If v3 behaves differently, our
retry guidance to the model is wrong on the path that actually matters.

**A2. RESOLVED, 2026-07-28 — by live verification recorded in `tests/fixtures/write-errors.ts`
on this branch.** Verified against both Core (3.11.0-nightly) and Enterprise
(3.11.0-0.rc.1, `--upgrade-pacha-tree`), identical on both. `data.error` is the generic
`"partial write of line protocol occurred"`; the tag name is one level down, under
`data.data[].error_message`: `"invalid line protocol - multiple instances of '<tag>' tag
found"`. This means P1's fix cannot reuse `handleQueryError`'s flat resolution order
unmodified — it must unwrap the partial-write array first. See `patch-1.4.1-spec.md` P1.

**A3. Does `accept_partial=true` change the status or body shape for that rejection?**
*(Non-blocking.)*
Whole-batch refusal and partial success need different handling. The MCP server sends
`accept_partial` on the Core/Enterprise v3 path, so whichever it is, we hit it.

**A4. Are there other newly-rejected line-protocol conditions in 3.11 beyond duplicate tag
keys?** *(Non-blocking.)*
The notes describe duplicate tag keys as now refused "the same way duplicate field keys
already were." If other validations tightened in the same pass, they need the same
error-fidelity treatment and the same test coverage.

## B. Version and engine detection

**B1. Is `x-influxdb-version` on `/ping` guaranteed present and stably formatted on 3.11 Core
and Enterprise?** *(Blocking the capability probe.)*
The RC reports `3.11.0-0.rc.1`. What does GA report — `3.11.0`? Any capability gated on
"3.11 or later" needs a parseable, guaranteed-present version string, and we would rather not
build a parser around a header that is incidental.

**B2. Is there a sanctioned way to detect the active storage engine over the HTTP API?**
*(Blocking.)*
PachaTree, Parquet, or hybrid `ParquetAndPachaTree` — without CLI or direct catalog access.
The notes say the engine is resolved from the catalog's persisted storage mode, which is not
something an HTTP client can read. Is querying `system.pt_*` the intended probe, or is there
a status or catalog endpoint we should use instead?

**B3. RESOLVED — documented, sanctioned mechanism exists.** The Enterprise admin docs
(`docs.influxdata.com/influxdb3/enterprise/admin/query-system-data/`) document
`system.upgrade_parquet_node` (per-node upgrade status) and `system.upgrade_parquet`
(per-file migration progress) specifically for this state. "Monitor
`system.upgrade_parquet_node` to confirm each node reaches `completed` status." Status
updates on a polling interval (default 5s, `--upgrade-poll-interval`). No derivation needed —
query these two tables directly instead of inferring migration state from `pt_*` presence.

## C. System tables

**C1. Still open — confirmed as a real documentation gap, not just an unasked question.**
*(Blocking.)* An admin token can always read any table, including `pt_*` — that much isn't in
question. What's undocumented is the *minimum* scope: Enterprise resource tokens support a
`system:<endpoint>:read` permission format (`admin/tokens/resource/`), and `system.tokens`
specifically is documented as needing admin access or `_internal`-database read access
(`admin/tokens/admin/list/`) — but nothing in the docs states which permission, if any short of
admin, is sufficient for `system.queries`, `system.parquet_files`, or the `pt_*` tables. This
still decides the capability's risk posture — the same question as originally asked, now with
confirmation that the docs don't answer it either, so it has to go to the implementing team or
be checked live with a scoped, non-admin token.

**C2. Are their column schemas public and stable for 3.11, or internal and subject to
change?** *(Blocking — a hard gate.)*
If internal, a supported capability cannot be built on them and the spec stops. We would need
either a stability commitment or a supported alternative.

**C3. Do they surface in `information_schema.columns`, and under which `table_schema`?**
*(Blocking patch item P6.)*
The MCP server's schema tools filter on `table_schema = 'iox'`
(`src/services/query.service.ts:302-303`, `:552`), so this determines whether the new tables
appear in schema listings at all. Our expectation is that they do not, and that this causes no
error — impact map 1.4 asks us to confirm exactly that.

**C4. RESOLVED — direct column, not derived.** `system.pt_compaction_ingest_nodes` has a
`compaction_lag` column per node directly. Backlog is also directly readable:
`deferred_snapshot_count` (non-zero means snapshots are failing to compact and accumulating) —
check `system.pt_compaction_deferred_snapshots.error_message` for why. No heuristic needed.
Also note: the "five new system tables" the impact map and this spec cite understate the
surface. The Enterprise admin docs list at least five more compaction-specific `pt_*` tables —
`pt_compaction_active_jobs`, `pt_compaction_ingest_nodes`, `pt_compaction_nodes`,
`pt_compaction_run_sets`, `pt_compaction_deferred_snapshots` — none named in
`inspect-storage-spec.md`'s backing-tables list. The `compaction` aspect needs these, not just
`pt_compaction_files`.

**C5. On Core (Parquet-only), what is the failure mode for a `system.pt_*` query — empty
result or error?** *(Blocking the probe design.)*
The probe treats failure as "not PachaTree." An empty success would be read as a healthy
PachaTree cluster with no shards, which is the wrong answer.

## D. Authentication and tokens

**D1. Is `--user-auth-type` (`basic` / `oauth` / `none`) enforced on Enterprise HTTP API
routes, or only on Web UI routes?** *(Non-blocking for the patch; significant for the
migration.)*
Carried forward from the brief, where it is the highest-leverage open question. It does not
change the patch — we have confirmed it does not affect API tokens today. It matters because
the 2026-07-28 specification makes MCP servers OAuth 2.1 resource servers, and a real OAuth
mode wired to a customer identity provider could be the identity foundation MCP needs instead
of a second auth system built alongside it. The brief's sub-questions still stand: what does
`oauth` mode integrate with, does it expose standard OpenID Connect discovery, and after a
user authenticates, what authorizes their database operations?

**D2. Do `/ping` and `/health` on 3.11 Core and Enterprise accept `Bearer`, `Token`, or both
— and do they require auth at all?** *(Non-blocking — PR #69 already merged the `Bearer`
fix to `main` at `9460044`, 2026-07-28. This is now a confirm-on-live-matrix item, not a
gate on P5's implementation.)*
PR #69 asserts `Bearer` is required, on the grounds that Enterprise v3.10 added experimental
JWT user auth and hardcoded `Token` breaks it. Confirm that reasoning holds for 3.11 GA, and
whether both schemes remain accepted, during the test-matrix pass.

**D3. Does 3.11 change token scopes or the operator/admin token model on Enterprise?**
*(Non-blocking.)*
The notes do not mention it, and we are treating it as unchanged. Worth a confirmation, since
the permission-scoped tool design rests on Enterprise tokens having meaningfully limited
permissions.

## E. Test environment

**E1. Which 3.11 GA artifacts should the test matrix pin?** *(Blocking the matrix.)*
The internal notes give RC image digests. Is there a GA tag to target instead of
`3.11.0-0.rc.1`, and will the digests change at GA?

**E2. Is there a supported way to script a Parquet→PachaTree migration in CI, and how long
does the hybrid state persist?** *(Blocking matrix row 2.)*
The impact map calls the upgraded-Enterprise row the one where surprises are likeliest, so we
need to hold a cluster in the hybrid state deterministically. If the migration completes
quickly under a small test dataset, the row tests nothing.

**E3. Do Enterprise test containers need `--mode all,webui` and a session secret, or is plain
`--mode all` sufficient?** *(Non-blocking.)*
Our tests do not exercise the UI. The notes are explicit that the Web UI is not included in
`--mode all` and that a session secret is mandatory when `webui` is added — we want to confirm
we can simply omit it.

## F. Release governance

**F1. RESOLVED, 2026-07-28 — by the merge itself, not a governance decision.** PR #69 merged
to `main` (`9460044`) before 1.4.0 published, so the read-only capability is already folded
into the unpublished 1.4.0. npm still publishes 1.3.0. See [`PLAN.md`](PLAN.md) for the
updated sequencing: 1.4.0 (as `main` now stands) → 1.4.1 (the 3.11 patch).

**F2. RESOLVED, 2026-08-05 — `inspect_storage` is admitted on the 1.x line, sign-off
granted, sequenced after 1.4.1.** `inspect_storage` ships as a later 1.x release, not 2.0 —
but only after the 1.4.1 patch (P1–P7) ships first. The patch fixes live defects against an
already-released version and has no open decisions left blocking it; `inspect_storage` is new
work with no deadline pressure (F3), so it queues behind the patch rather than racing it.
Target-release wording in `inspect-storage-spec.md`'s Governance section should change from
"target 2.0" to "next 1.x release after 1.4.1."

**F3. RESOLVED, 2026-08-05 — `inspect_storage` stays this plan's new capability; Cloud
support gets its own planning pass, timed to land before Cloud's GA.** Decision made on
scope fit: Cloud support isn't "one new capability," it's a full workstream (new product
type, new auth, new connection plane) that this plan was never scoped to design, even though
it's freeze-exempt and deadline-driven. `inspect_storage` is right-sized and already specced.
The two aren't a single either/or — both need the same capability-detection prerequisite
(below), so specifying `inspect_storage` now wastes nothing. Cloud support's own plan still
needs to start with enough runway to ship by GA; see the record below for why the comparison
was even on the table.

`inspect_storage` was selected in part because the InfluxDB 3 Cloud workstream could not be
named in a tracked artifact. That restriction is lifted, so the comparison was open on merits:

| | `inspect_storage` | InfluxDB 3 Cloud support |
|---|---|---|
| Freeze status | Needs sign-off (F2); contradicts workstream 2's guardrail | **Named exemption** — already permitted |
| Deadline | None | **Hard** — customers connecting at GA run the current server |
| Scope | Core/Enterprise, matches this plan's stated scope | Enterprise-shaped; a full workstream, not one tool |
| 3.11 linkage | Directly unlocked by the new `system.pt_*` tables | Independent of 3.11 |
| Shared prerequisite | Capability detection | Capability detection — **the same mechanism** |

Note the last row: both need the deployment-capability probe described in
[`inspect-storage-spec.md`](inspect-storage-spec.md), which the server lacks entirely today.
That work is common to either answer and can start before this is decided.
