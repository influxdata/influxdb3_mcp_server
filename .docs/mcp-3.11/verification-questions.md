# Verification questions — what still has to be tested

- **Updated:** 2026-08-06
- **Verified against:** `main` HEAD `249f612` (version `1.4.1-test.1`), InfluxDB `3.11.0` GA
  (Core revision `139bab4c54b54db01d67539b6dc9f1e1a81dd1b7`, Enterprise revision
  `e5242f505d23039a340d21693a994b1a053b0f15` — both now the pinned defaults in docs-tooling's
  `docker-compose.yml`)
- **Status:** twelve sub-items verified live this session (Core + Enterprise 3.11.0 GA, via
  docs-tooling's shared containers): A1, E1, B1, C3, C5, A3, A4, C1, D2, D3, plus the observable
  halves of C2 and B2. Six sub-items remain open — see below.
- **Replaces:** `open-questions-core-enterprise.md` (deleted). Question IDs are unchanged, so
  the cross-references in [`PLAN.md`](PLAN.md), [`patch-1.4.1-spec.md`](patch-1.4.1-spec.md),
  and [`inspect-storage-spec.md`](inspect-storage-spec.md) still resolve.

Of the previous pass's 21 tracked sub-items, twelve are now resolved (see
[Closed questions](#closed-questions)), leaving six open: **C2**'s stability gate and **B2**'s
sanctioned-probe half (both Engineering-only), **D1**'s observable half (not run this session)
and oauth half (Engineering-only), and **E2**/**E3** (Parquet→PachaTree hybrid fixture, not yet
built). The previous version of this list routed most items to the Core/Enterprise implementing
team. That was wrong for all but a few sub-items: most of what's below turned out to be directly
observable on an instance we can start ourselves. This file is organized by **what you need
running**, not by who owns the answer, so each section is one setup and several questions
against it.

Per `tests/README.md`, each question here should land as an `it.todo(...)` naming its ID —
none exist yet, so the open list is currently invisible in CI output.

## Setup

| Instance                      | How                                                                                                                                        | Used by |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **Core 3.11**                 | docs-tooling `docker compose up influxdb3-core` (GA `3.11.0`, port 8282) — or `npm run test:infra:up` locally                              | §1, §2  |
| **Enterprise 3.11, fresh**    | docs-tooling `docker compose up influxdb3-enterprise` (GA `3.11.0`, PachaTree by default, port 8181) — matrix row 1                        | §3, §4  |
| **Enterprise 3.11, upgraded** | `--upgrade-pacha-tree` over a Parquet catalog — matrix row 2. Not yet built; no fixture exists                                             | §5      |
| **Enterprise, multi-node**    | docs-tooling `docker compose up influxdb3-enterprise influxdb3-enterprise-verify-node1 influxdb3-enterprise-verify-node2` — 3-node cluster | §2 (A1) |

`docker-compose.test.yml` (this repo) still pins `influxdb:3-core`, not a 3.11 tag — that gap
is unchanged. Prefer docs-tooling's compose file, which now pins the GA digests above by
default.

---

## §1 — Core 3.11, single node: write-path error shapes — CLOSED

Verified live 2026-08-06 against Core 3.11.0 GA (docs-tooling `influxdb3-core`, port 8282).

**A3 — RESOLVED.** `accept_partial` changes both the top-level `error` string and the shape of
`data`, not just whether the batch partially succeeds:

```
accept_partial=true  → 400 {"error":"partial write of line protocol occurred",
                             "data":[{"error_message":"invalid line protocol - multiple instances of 't' tag found","line_number":1,"original_line":"..."}]}

accept_partial=false → 400 {"error":"line protocol parsing error",
                             "data":{"error_message":"invalid line protocol - multiple instances of 't' tag found","line_number":1,"original_line":"..."}}
```

`data` is an **array** when `accept_partial=true`, a flat **object** when `false`. The MCP
server always sends `accept_partial=true` (`write.service.ts:82`), so production traffic only
ever hits the array shape — but P1's resolver should handle both defensively, since
`accept_partial` is a query param the resolver's own code path could see either value for.
**P1's resolver needs a second arm**, confirming the concern this question was written to
settle.

**A4 — RESOLVED.** Swept five more conditions against the same endpoint (`accept_partial=true`,
Core 3.11.0 GA). All five hit the identical shape as A2/A3's `true` case — 400,
`data.error: "partial write of line protocol occurred"`, `data.data[0].error_message` — no new
shape, no third resolver arm needed:

| Case                                   | Line protocol           | `error_message`                                                                                                      |
| -------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Duplicate tag key (A2, known)          | `m,t=a,t=a f=1i`        | `invalid line protocol - multiple instances of 't' tag found`                                                        |
| Duplicate field key                    | `m,t=a f=1i,f=2i`       | `invalid line protocol - multiple instances of 'f' field found`                                                      |
| Tag/field name collision               | `m,x=a x=1i`            | `invalid column type for column 'x', expected iox::column_type::tag, got iox::column_type::field::integer`           |
| Empty tag value                        | `m,t= f=1i`             | `` Expected tag value, got ` f=1i ...` ``                                                                            |
| Missing field set                      | `m,t=a`                 | `No fields were provided`                                                                                            |
| Type conflict (write int, then string) | `m f=1i` then `m f="s"` | `invalid column type for column 'f', expected iox::column_type::field::integer, got iox::column_type::field::string` |

All six (A2 + these five) should land in `tests/fixtures/write-errors.ts` as named cases — the
table above has the exact `error_message` text for each.

---

## §2 — Stopped node: the 503 question — CLOSED

**A1. What does `POST /api/v3/write_lp` return when a target node is stopped?**
_(Was "blocking P3." It is not — see below.)_

> **Reviewer note (2026-08-06): the previous framing of this question was flawed.** It argued
> that because the 3.11 notes document the 400→503 change for `/api/v2/write` only, and
> Core/Enterprise use v3 exclusively, "as written the change does not reach them." That
> infers v3's behavior from the notes' silence about v3, which is not evidence. It also
> claimed "our retry guidance to the model is wrong" — there is no retry guidance to be wrong:
> `handleWriteError` (`src/services/write.service.ts:193-214`) has no 503 arm at all, so any
> 503 already falls through to the `[object Object]` fallback (P2). The v2/v3 split is a
> reason the note might not apply, not a finding that it doesn't.

**RESOLVED — no 503, connection-level failure only.** Tested live 2026-08-18 against a real
3-node Enterprise 3.11.0 GA cluster (docs-tooling `influxdb3-enterprise` +
`influxdb3-enterprise-verify-node1` + `-node2`, shared cluster-id, shared MinIO object store —
see `docs-tooling/docker-compose.yml`).

With all three nodes up, wrote to `node0` (`:8181`) — succeeded. Stopped `node1`, wrote to
`node0` again — still succeeded (204), confirming the rest of the cluster stays available.
Then wrote directly to `node1`'s own (stopped) port `:8183`:

```
curl: (7) Failed to connect to localhost port 8183 after 0 ms: Couldn't connect to server
```

**A plain TCP connection failure, not an HTTP 503.** There is no reverse proxy or load balancer
in front of this cluster (each node's port is a direct Docker port mapping), and each node runs
`--mode=all` — fully independent, no internal write-forwarding between nodes. A client that
targets a specific node directly gets exactly what the single-node case would give: connection
refused when that node is down. **No v3 503 was observed in this topology.** This confirms the
weaker fallback verification-questions.md originally proposed as a stand-in was, in fact, the
real answer, not just an approximation of one.

**What this means for P2:** the 503 arm P2 adds is not exercised by "one node in a
same-role, no-proxy cluster is down" — that case is a connection error, which
`handleWriteError` already reaches via its catch-all path (not via any status-code branch). A
v3 503 would need to come from an actual proxy/load balancer in front of a production
deployment, or from a topology with internal request-forwarding this test didn't cover
(e.g. a dedicated query/coordinator node forwarding writes to a specific ingest peer). P2's
503 arm still ships — the gap it fixes (`[object Object]` on any object-body error, regardless
of status) is real independent of this finding — but this closes the "does v3 return 503 for a
down node" question as **no, not in this configuration**, rather than leaving it open.

**Record:** closes P3 as "confirmed, no v3 503 change reaches this configuration." The 503
acceptance test in `tests/write-error-core.test.ts:195` should stay a synthetic fixture — this
test found no live 503 to back it with.

---

## §3 — Enterprise 3.11 (PachaTree): system tables and detection — CLOSED

Verified live 2026-08-06 against Enterprise 3.11.0 GA (docs-tooling `influxdb3-enterprise`,
port 8181, fresh PachaTree, no upgrade flags — matrix row 1).

**C3 — RESOLVED.** `pt_*` tables live under `table_schema = 'system'`, not `'iox'`:

```
SELECT DISTINCT table_schema, table_name FROM information_schema.columns WHERE table_name LIKE 'pt_%';
→ all 12 rows: table_schema = "system"
```

`get_measurements`'s actual query (`SELECT DISTINCT table_name FROM information_schema.columns
WHERE table_schema = 'iox'`) confirmed clean against a database with a real measurement written
into it: only the real measurement appeared, zero `pt_*` pollution, no error. **Closes impact
map 1.4 — P6 confirmed, no code change needed.**

---

**C2 (observable half) — RESOLVED for "what exists today."** Full schema dump
(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name
LIKE 'pt_%' ORDER BY table_name, ordinal_position`) found **12 tables, not the 10 the spec's
aspect-to-table mapping assumed**:

| Table                              | Columns |
| ---------------------------------- | ------- |
| `pt_compaction_active_jobs`        | 10      |
| `pt_compaction_deferred_snapshots` | 4       |
| `pt_compaction_files`              | 14      |
| `pt_compaction_ingest_nodes`       | 11      |
| `pt_compaction_nodes`              | 6       |
| `pt_compaction_run_sets`           | 15      |
| `pt_ingest_files` **(new)**        | 12      |
| `pt_ingest_wal` **(new)**          | 13      |
| `pt_shards`                        | 5       |
| `pt_storage_checkpoints`           | 8       |
| `pt_storage_run_set_indexes`       | 6       |
| `pt_storage_snapshots`             | 14      |

All 10 originally-expected tables exist; `pt_ingest_wal` and `pt_ingest_files` are additional
and unaccounted for in `inspect-storage-spec.md`'s aspect-to-table mapping — **that mapping
needs to be rebuilt to include them.** The stability gate (is this schema public/contractual
across versions, or could it change in 3.12) is unchanged and still needs Engineering — see
[Needs Engineering](#needs-engineering-not-testable-locally).

---

**B2 (observable half) — RESOLVED.** Only the system-table probe distinguishes PachaTree from
Parquet. Checked every alternate candidate on both Core and Enterprise: `/health` (200 on both,
no distinguishing field), `/metrics` (Prometheus text; grepped for storage/mode/engine/pacha/
parquet — only unrelated cache-status labels, no storage-mode field), `/api/v3/configure`
(404 on both — no such discovery endpoint exists). **None of the alternates expose storage
mode.** `system.pt_*` query success/failure (see C5, next) is the only working signal. Whether
it's the _sanctioned_ one is still an Engineering question (unchanged, see below).

---

**C5 — RESOLVED, better than the worst case.** Core (Parquet-only) returns a clean planning
error, not an empty success:

```
POST /api/v3/query_sql {"q":"SELECT 1 FROM system.pt_shards LIMIT 1", ...}
→ 400 Bad Request: "Error during planning: table 'public.system.pt_shards' not found"
```

`information_schema.columns` also returns **zero rows** for `pt_%` on Core — the schema plainly
doesn't exist there, not just hidden. The probe can safely use query success/failure as the
signal; the spec's worried-about failure mode (an empty 200 misread as "healthy PachaTree
cluster with zero shards") does not occur. **Closes the probe-design half of this question.**

---

**B1 — RESOLVED.** `x-influxdb-version` is present and reports plain `3.11.0` (no RC suffix) on
both Core and Enterprise GA, confirming "3.11 or later" can be a simple semver parse:

```
Authenticated:   x-influxdb-version: 3.11.0   x-influxdb-build: Core | Enterprise
Unauthenticated: header absent entirely (401, no x-influxdb-* headers at all)
```

**The probe must handle the unauthenticated case as "header absent," not "header empty"** — if
it runs before a token is validated, there is nothing to parse yet, not an empty string.

---

## §4 — Enterprise 3.11: tokens and auth — MOSTLY CLOSED

Verified live 2026-08-06 against Enterprise 3.11.0 GA, using a **scoped, non-admin** token
created via `influxdb3 create token --permission`.

**C1 — RESOLVED, and more permissive than the spec feared.** Created three tokens and tested
`SELECT * FROM system.pt_shards LIMIT 1` with each:

| Token                                      | Result                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain per-database read (`db:<name>:read`) | **Succeeds** — real per-database shard data returned. No special permission needed.                                                                                                   |
| `system:*:read` alone                      | 403 — on this query _and_ on a plain `SELECT 1` against the same db. This permission does not grant `/api/v3/query_sql` access at all; it gates a different, non-SQL system endpoint. |
| `db:_internal:read`                        | 403 — including on a plain `SELECT 1` against `_internal`. Confirms `_internal` requires admin/operator regardless of an explicit db-scoped grant naming it.                          |

**A plain database-read token is sufficient for `system.pt_*` scoped to that database** —
`inspect-storage-spec.md`'s guardrail language ("query permission only, no operator token") is
validated as written for ordinary databases. It is **not** sufficient for anything under
`_internal`, which stays admin/operator-only regardless of grant. **Closes — decides the
capability's risk posture in inspect_storage's favor.**

---

**D2 — RESOLVED.** 3×2 auth matrix, identical on Core and Enterprise:

```
Bearer <token>  →  ping: 200   health: 200
Token <token>   →  ping: 200   health: 200
(no header)     →  ping: 401   health: 401
```

Both schemes accepted, no anonymous access on either endpoint. Confirms `createAuthHeader()`'s
Bearer choice works, and that the legacy Token scheme is still accepted too (no breaking
change either way).

---

**D3 — RESOLVED as a side effect of C1.** Nothing in C1's results contradicts the documented
token model: ordinary db-scoped permissions behave as documented, `_internal` stays gated to
admin/operator. Closes.

---

**D1 (observable half) — NOT RUN this session.** Would require restarting Enterprise with
`--user-auth-type basic`, which means taking down the shared dev instance a second time in one
session — deliberately deferred rather than done reflexively. Still open; the check itself is
unchanged from the original write-up (start with `--user-auth-type basic`, confirm `/ping`,
`/api/v3/query_sql`, `/api/v3/write_lp` still work with an ordinary API token). The design half
(what OAuth mode integrates with) remains Engineering's, unchanged.

---

## §5 — Enterprise upgraded from Parquet: hybrid state

Setup: Parquet-mode Enterprise with data, restarted with `--upgrade-pacha-tree`. Matrix row 2
— the impact map calls this the row where surprises are likeliest.

**E2. Can a Parquet→PachaTree migration be scripted deterministically, and how long does the
hybrid state persist?** _(Blocking matrix row 2.)_

If the migration completes in seconds under a small test dataset, the row tests nothing —
there's no hybrid window to query across. Two things to establish: how much data is needed to
hold the hybrid state open long enough to run a query spanning both engines, and whether
`--upgrade-poll-interval` (default 5s) can be raised to widen the window on purpose.

```sql
-- migration progress, per B3's resolved mechanism
SELECT * FROM system.upgrade_parquet_node;   -- per-node status; watch for 'completed'
SELECT * FROM system.upgrade_parquet;        -- per-file progress
```

**Record:** dataset size vs. time-to-completed, whether `--upgrade-poll-interval` widens the
window usefully, and a single query that demonstrably spans old-Parquet and new-PachaTree data.

---

**P6 / the hybrid half of C3 and P1.** While the hybrid state is held open, re-run the §3 and
§1 checks against it: `get_measurements` / `get_measurement_schema` (result structure, data
types, error wording unchanged from Parquet — impact map 1.3), and one duplicate-tag-key
write. **Record:** any difference from the fresh-PachaTree results.

---

**E3. Do Enterprise test containers need `--mode all,webui` and a session secret, or is plain
`--mode all` sufficient?** _(Non-blocking — but it's the first thing that will bite when you
start the container.)_

Our tests don't exercise the UI. The notes are explicit that the Web UI is not in `--mode all`
and that a session secret is mandatory once `webui` is added. Just start it with `--mode all`
and see whether everything in §3–§5 works.

**Record:** yes/no, plus the working container command, so it can go into a
`docker-compose.enterprise.test.yml` alongside the existing Core one.

---

## Needs Engineering (not testable locally)

Three sub-items, down from the previous list's twenty questions. Each is a commitment or a
design fact, not a behavior:

| ID            | Question                                                                                                                                 | Why it can't be tested                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2** (gate) | Are the `pt_*` column schemas **public and stable** for 3.11, or internal and subject to change?                                         | Observing today's schema (§3 — now including `pt_ingest_wal`/`pt_ingest_files`) doesn't tell us whether it may change in 3.12. A hard gate: if internal, `inspect_storage` cannot be built on them and the spec stops. |
| **B2** (half) | Is querying `system.pt_*` the **sanctioned** engine probe, or is there an intended status/catalog endpoint?                              | §3 confirmed it's the only _working_ probe; only Engineering can say whether it's _supported_. Ship-blocking only if the working probe turns out to be one they'd rather we didn't depend on.                          |
| **D1** (half) | What does `--user-auth-type oauth` integrate with, does it expose OIDC discovery, and what authorizes DB operations post-authentication? | Design information. Matters for the protocol migration (MCP servers are OAuth 2.1 resource servers as of the 2026-07-28 spec), not for this patch.                                                                     |

Send C2 first. It is the only one that can stop a deliverable.

---

## Closed questions

Kept as a record so nothing looks silently dropped.

| ID                       | Resolution                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2**                   | Duplicate-tag-key response shape — resolved by live verification, recorded in `tests/fixtures/write-errors.ts` (on `main`). `data.error` is the generic `"partial write of line protocol occurred"`; the tag name is under `data.data[].error_message`. Identical on Core 3.11.0-nightly and Enterprise 3.11.0-0.rc.1. Drives P1's resolver design.                     |
| **B3**                   | Hybrid-migration detection — `system.upgrade_parquet_node` (per-node status) and `system.upgrade_parquet` (per-file progress) are documented and sanctioned for exactly this. No inference from `pt_*` presence needed.                                                                                                                                                 |
| **C4**                   | Compaction-lag detection — `system.pt_compaction_ingest_nodes.compaction_lag` is a direct per-node column; `deferred_snapshot_count` plus `system.pt_compaction_deferred_snapshots.error_message` cover backlog. No heuristic needed.                                                                                                                                   |
| **F1**                   | Version anchor — 1.4.0 published 2026-07-30 with PR #69's read-only capability folded in. Sequencing: 1.4.0 → 1.4.1 (this patch).                                                                                                                                                                                                                                       |
| **F2**                   | Target release for `inspect_storage` — admitted on the 1.x line with sign-off, sequenced after 1.4.1 ships.                                                                                                                                                                                                                                                             |
| **F3**                   | `inspect_storage` vs. InfluxDB 3 Cloud support — `inspect_storage` stays this plan's new capability; Cloud support gets its own plan, timed to land before Cloud's GA. Both need the same capability-detection prerequisite.                                                                                                                                            |
| **E1**                   | GA tag — confirmed 2026-08-06: `3.11.0` (no RC suffix). Core revision `139bab4c54b54db01d67539b6dc9f1e1a81dd1b7`, Enterprise revision `e5242f505d23039a340d21693a994b1a053b0f15`. Both now the pinned defaults in docs-tooling's `docker-compose.yml`.                                                                                                                  |
| **B1**                   | `x-influxdb-version` — present and `3.11.0` when authenticated on both Core and Enterprise; absent entirely (not empty) when unauthenticated. Confirms "3.11 or later" can be a simple semver parse. See §3.                                                                                                                                                            |
| **C3**                   | `pt_*` tables live under `table_schema = 'system'`, not `'iox'` — `get_measurements`'s `table_schema = 'iox'` filter excludes them by construction, confirmed clean against real data. Closes impact map 1.4.                                                                                                                                                           |
| **C2** (observable half) | Live schema dump found 12 `pt_*` tables, not the 10 previously assumed — `pt_ingest_wal` and `pt_ingest_files` are additional. `inspect-storage-spec.md`'s aspect-to-table mapping needs rebuilding to include them. The stability _gate_ (public/contractual vs. internal) is unchanged and still needs Engineering.                                                   |
| **B2** (observable half) | Only the `system.pt_*` query works as a PachaTree-vs-Parquet probe — `/health`, `/metrics`, and `/api/v3/configure` were all checked and expose no storage-mode field. Whether it's the _sanctioned_ probe is still open (needs Engineering).                                                                                                                           |
| **C5**                   | Core returns a clean `400` planning error for `system.pt_*` queries (`table ... not found`), not an empty `200` — the spec's worried-about failure mode doesn't occur. Query success/failure is a safe probe signal.                                                                                                                                                    |
| **A3**                   | `accept_partial=false` does not collapse to a flat `data.error` as guessed — it's a flat `data` **object** (vs. an array when `true`), with a different top-level `error` string too (`"line protocol parsing error"` vs. `"partial write of line protocol occurred"`). P1's resolver needs a second arm.                                                               |
| **A4**                   | Swept 5 more rejected-write conditions on Core 3.11 GA — duplicate field key, tag/field collision, empty tag value, missing field set, field type conflict. All five match A2/A3's `accept_partial=true` shape exactly; no third resolver arm needed. Exact `error_message` text recorded in §1 for `tests/fixtures/write-errors.ts`.                                   |
| **C1**                   | A plain per-database read token (`db:<name>:read`) is sufficient to query `system.pt_*` scoped to that database — no special `system:*:read` or admin/operator token needed. `_internal` stays admin/operator-only regardless of grant. Validates `inspect-storage-spec.md`'s guardrail language as written.                                                            |
| **D2**                   | `/ping` and `/health` accept both `Bearer` and `Token` on Core and Enterprise 3.11 GA; neither allows anonymous access (401 with no auth header). Confirms `createAuthHeader()`'s Bearer choice, and that Token still works too.                                                                                                                                        |
| **D3**                   | Nothing in C1's live results contradicts the documented Enterprise token model. Closes as a side effect of C1.                                                                                                                                                                                                                                                          |
| **A1**                   | Stopped-node write, tested on a real 3-node Enterprise cluster: writing directly to a stopped node's own port returns a plain TCP connection failure, not an HTTP 503 — confirmed no v3 503 change reaches this configuration (no proxy in front, no inter-node forwarding). Closes P3. The rest of the cluster (a live node) keeps serving writes normally throughout. |
