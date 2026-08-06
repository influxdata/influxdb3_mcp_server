# Verification questions — what still has to be tested

- **Updated:** 2026-08-06
- **Verified against:** `main` HEAD `249f612` (version `1.4.1-test.1`), InfluxDB `3.11.0-0.rc.1`
- **Status:** ready to run — every item below is answerable on a local instance
- **Replaces:** `open-questions-core-enterprise.md` (deleted). Question IDs are unchanged, so
  the cross-references in [`PLAN.md`](PLAN.md), [`patch-1.4.1-spec.md`](patch-1.4.1-spec.md),
  and [`inspect-storage-spec.md`](inspect-storage-spec.md) still resolve.

Fifteen questions remain. Six are closed — see [Closed questions](#closed-questions) at the bottom.

The previous version of this list routed most of these to the Core/Enterprise implementing
team. That was wrong for all but four sub-items: everything else is directly observable on an
instance we can start ourselves. This file is organized by **what you need running**, not by
who owns the answer, so each section is one setup and several questions against it.

Per `tests/README.md`, each question here should land as an `it.todo(...)` naming its ID —
none exist yet, so the open list is currently invisible in CI output.

## Setup

| Instance                      | How                                                                                         | Used by      |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| **Core 3.11**                 | `npm run test:infra:up` (`docker-compose.test.yml`, `influxdb:3-core`, memory object store) | §1, §2       |
| **Enterprise 3.11, fresh**    | PachaTree by default, no flags — matrix row 1                                               | §3, §4       |
| **Enterprise 3.11, upgraded** | `--upgrade-pacha-tree` over a Parquet catalog — matrix row 2                                | §5           |
| **Enterprise, multi-node**    | Two ingest nodes, one stoppable                                                             | §2 (A1 only) |

`docker-compose.test.yml` pins `influxdb:3-core`, not a 3.11 tag. Pin the tag before running
anything version-specific, or the answers below are about whatever `3-core` resolves to today.

---

## §1 — Core 3.11, single node: write-path error shapes

Setup: `npm run test:infra:up`, then write directly with `curl` against
`POST /api/v3/write_lp` (the endpoint Core/Enterprise use — `src/services/write.service.ts:85-100`).
The MCP server always sends `accept_partial=true` on this path, so test with that default and
without it.

**A3. Does `accept_partial=true` change the status or body shape for a rejected line?**
_(Non-blocking — refines P1's resolver.)_

```bash
TOK=apiv3_test
for AP in true false; do
  echo "--- accept_partial=$AP ---"
  curl -sS -i -X POST "http://localhost:8181/api/v3/write_lp?db=test&precision=nanosecond&accept_partial=$AP" \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: text/plain; charset=utf-8' \
    --data-binary 'm,t=a,t=a f=1i'
done
```

Whole-batch refusal and partial success need different handling in the resolver. The verified
shape recorded in `tests/fixtures/write-errors.ts` is the `accept_partial=true` one
(`data.error` generic, tag name under `data.data[].error_message`). What P1 needs to know is
whether the `false` path collapses to a flat `data.error` — if so, the resolver must handle
both, not just the partial-write array.

**Record:** status code and full body for each, and whether P1's resolver needs a second arm.

---

**A4. Are there other newly-rejected line-protocol conditions in 3.11 beyond duplicate tag
keys?** _(Non-blocking — scopes P1's test coverage.)_

The 3.11 notes describe duplicate tag keys as now refused "the same way duplicate field keys
already were." If other validations tightened in the same pass, they need the same
error-fidelity treatment and the same fixtures. Sweep the obvious candidates against the same
endpoint:

| Case                               | Line protocol           |
| ---------------------------------- | ----------------------- |
| Duplicate tag key (known)          | `m,t=a,t=a f=1i`        |
| Duplicate field key                | `m,t=a f=1i,f=2i`       |
| Tag/field name collision           | `m,x=a x=1i`            |
| Type conflict on an existing field | `m f=1i` then `m f="s"` |
| Empty tag value                    | `m,t= f=1i`             |
| Missing field set                  | `m,t=a`                 |

**Record:** which of these 3.11 rejects up front, at what status, and whether any produces a
body shape the P1 resolver would not reach. Anything new goes into
`tests/fixtures/write-errors.ts` alongside the duplicate-tag-key fixture.

---

## §2 — Stopped node: the 503 question

**A1. What does `POST /api/v3/write_lp` return when a target node is stopped?**
_(Was "blocking P3." It is not — see below. Verify and close.)_

> **Reviewer note (2026-08-06): the previous framing of this question was flawed.** It argued
> that because the 3.11 notes document the 400→503 change for `/api/v2/write` only, and
> Core/Enterprise use v3 exclusively, "as written the change does not reach them." That
> infers v3's behavior from the notes' silence about v3, which is not evidence. It also
> claimed "our retry guidance to the model is wrong" — there is no retry guidance to be wrong:
> `handleWriteError` (`src/services/write.service.ts:193-214`) has no 503 arm at all, so any
> 503 already falls through to the `[object Object]` fallback (P2). The v2/v3 split is a
> reason the note might not apply, not a finding that it doesn't.

Restated: what status and body does v3 return for an unavailable node on 3.11? Directly
observable — stop a node and write to it.

This blocks nothing in P1/P2. P2 adds a 503 arm phrased as retryable regardless of whether
3.11's v2 change has a v3 counterpart, because the arm is missing either way. The answer
decides two narrower things: whether the P3 verification item closes as "confirmed, no v3
change" or opens new work, and whether the 503 acceptance test in
`tests/write-error-core.test.ts:195` can be backed by a live fixture instead of a synthetic one.

```bash
# two-node Enterprise, then:
docker stop <ingest-node-2>
curl -sS -i -X POST "http://<host>:8181/api/v3/write_lp?db=test&precision=nanosecond&accept_partial=true" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: text/plain; charset=utf-8' \
  --data-binary "m,t=a f=1i $(date +%s%N)"
```

**Record:** status code, body, and whether the body distinguishes "retry" from "your request
is wrong". If a two-node Enterprise cluster is impractical, killing the single Core container
mid-write gives a weaker but still useful answer (connection-level failure rather than 503) —
note which one you ran.

---

## §3 — Enterprise 3.11 (PachaTree): system tables and detection

Setup: fresh Enterprise, no upgrade flags. Query through `/api/v3/query_sql`.

**C3. Do the `system.pt_*` tables surface in `information_schema.columns`, and under which
`table_schema`?** _(Blocking P6 — verification-only, no code change expected.)_

`get_measurements` and `get_measurement_schema` filter on `table_schema = 'iox'`
(`src/services/query.service.ts:753`, `:776`, `:1010`, `:1060`). The expectation is that the
new tables are excluded by construction and that this causes no error.

```sql
SELECT DISTINCT table_schema, table_name
FROM information_schema.columns
WHERE table_name LIKE 'pt_%';

-- and the exact query the MCP server runs:
SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'iox';
```

**Record:** the `table_schema` value for `pt_*` rows (if any), and confirmation that
`get_measurements` returns cleanly on a PachaTree instance. Closes impact map 1.4.

---

**C2 (observable half). What are the actual column schemas of the `pt_*` tables on 3.11?**
_(The stability commitment is a hard gate and is **not** testable — see
[Needs Engineering](#needs-engineering-not-testable-locally).)_

Capture the real schemas so the `inspect_storage` spec stops citing a table list assembled
from release notes plus docs:

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name LIKE 'pt_%'
ORDER BY table_name, ordinal_position;
```

Ten tables are expected: `pt_shards`, `pt_compaction_files`, `pt_storage_snapshots`,
`pt_storage_checkpoints`, `pt_storage_run_set_indexes`, `pt_compaction_active_jobs`,
`pt_compaction_ingest_nodes`, `pt_compaction_nodes`, `pt_compaction_run_sets`,
`pt_compaction_deferred_snapshots`.

**Record:** the full schema dump, and any table in that list that does not exist (or any
`pt_*` table not in it). This is what `inspect-storage-spec.md`'s aspect-to-table mapping
should be rebuilt from.

---

**B2 (observable half). Which probes actually distinguish PachaTree from Parquet over HTTP?**
*(Blocking the capability probe. Whether the working probe is *sanctioned* is an Engineering
question — see below.)*

Test each candidate on both a PachaTree Enterprise and a Parquet Core instance, and record
what each returns on each:

| Candidate                   | Probe                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| System-table presence       | `SELECT 1 FROM system.pt_shards LIMIT 1`                                                    |
| Version header              | `curl -sSI .../ping \| grep -i x-influxdb-`                                                 |
| Any status/catalog endpoint | `curl -sS .../health`, `.../metrics`, `/api/v3/configure/*` — look for a storage-mode field |

**Record:** which probes are unambiguous, and specifically whether anything short of querying
`system.pt_*` reports the storage mode.

---

**C5. On Parquet-only (Core), does a `system.pt_*` query error or return an empty result?**
_(Blocking the probe design.)_

The probe in `inspect-storage-spec.md` treats failure as "not PachaTree." An empty _success_
would be read as a healthy PachaTree cluster with zero shards — the wrong answer, and a silent
one.

```bash
# against Core (§1's container)
curl -sS -X POST "http://localhost:8181/api/v3/query_sql" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"db":"test","q":"SELECT 1 FROM system.pt_shards LIMIT 1","format":"json"}' -i
```

**Record:** status code and body on Core, and the same on PachaTree Enterprise for contrast.
If Core returns an empty 200, the probe must check for the table's _existence_ (via C3's
`information_schema` query) rather than for query success.

---

**B1. Is `x-influxdb-version` guaranteed present and stably formatted on 3.11 Core and
Enterprise?** _(Blocking the capability probe's version half.)_

`/ping` returns it (`src/services/base-connection.service.ts:302`) and nothing parses it —
every consumer passes the string through to output. The RC reports `3.11.0-0.rc.1`.

```bash
curl -sSI -H "Authorization: Bearer $TOK" http://localhost:8181/ping | grep -i 'x-influxdb-'
# repeat unauthenticated, and against Enterprise
```

**Record:** exact header values from Core, Enterprise, and (when available) a GA build. What
GA reports — `3.11.0`? — decides whether a "3.11 or later" gate can be a simple semver parse.
Also record whether the header is present when the request is unauthenticated, since the probe
may run before a token is validated.

---

## §4 — Enterprise 3.11: tokens and auth

Setup: same fresh Enterprise, plus a **scoped, non-admin** token. This section is the one the
previous list most wrongly routed to Engineering — the docs gap is real, but the answer is a
token away.

**C1. What is the minimum token scope that can read `system.pt_*`?** _(Blocking — decides the
capability's risk posture.)_

An admin token can read any table; that is not in question. Enterprise resource tokens support
a `system:<endpoint>:read` permission format, and `system.tokens` is documented as requiring
admin or `_internal` read — but nothing documents which permission, if any short of admin,
suffices for `system.queries`, `system.parquet_files`, or `pt_*`.

Create three tokens and try the same `SELECT` with each:

1. Database read token on the target database only.
2. Resource token with `system:<endpoint>:read` (try the `pt_*`-relevant endpoint names).
3. `_internal` database read token.

**Record:** for each token, whether `SELECT * FROM system.pt_shards LIMIT 1` succeeds, and the
error when it doesn't. The narrowest token that works becomes the documented requirement for
`inspect_storage`; if only admin works, the capability's guardrail language ("query permission
only, no operator token") in `inspect-storage-spec.md` is wrong and must change.

---

**D2. Do `/ping` and `/health` accept `Bearer`, `Token`, or both — and do they require auth at
all?** _(Non-blocking — confirm-only. The code fix already shipped in 1.4.0.)_

`createAuthHeader()` (`src/services/base-connection.service.ts:79-85`) now returns `Bearer` for
every product type except cloud-serverless, matching `http-client.service.ts`; covered by
`tests/base-connection-auth.test.ts`. This is a live confirmation that the reasoning holds on
3.11, not a gate on anything.

```bash
for H in "Authorization: Bearer $TOK" "Authorization: Token $TOK" ""; do
  for EP in ping health; do
    printf '%-40s %-8s ' "${H:-<none>}" "$EP"
    curl -sS -o /dev/null -w '%{http_code}\n' ${H:+-H "$H"} "http://localhost:8181/$EP"
  done
done
```

**Record:** the 3×2 status matrix on Core and on Enterprise.

---

**D3. Does 3.11 change token scopes or the operator/admin token model on Enterprise?**
_(Non-blocking.)_

The notes don't mention it and we're treating it as unchanged. The permission-scoped tool
design rests on Enterprise tokens having meaningfully limited permissions, so it's worth a
positive confirmation rather than an assumption. Largely answered as a side effect of C1 —
if the three tokens there behave as documented, this closes.

**Record:** whether anything in C1's results contradicts the documented token model.

---

**D1 (observable half). Is `--user-auth-type` enforced on Enterprise HTTP API routes, or only
on Web UI routes?** _(Non-blocking for the patch; significant for the protocol migration.)_

Start Enterprise with `--user-auth-type basic`, then hit the API routes the MCP server uses
(`/ping`, `/api/v3/query_sql`, `/api/v3/write_lp`) with an ordinary API token and confirm they
still work unchanged. That is the whole question as far as this patch is concerned — we have
assumed it doesn't affect API tokens, and this is a five-minute check of that assumption.

The rest of D1 — what `oauth` mode integrates with, whether it exposes OpenID Connect
discovery, and what authorizes database operations after a user authenticates — is design
information, not behavior, and stays with Engineering.

**Record:** status codes on each route under each `--user-auth-type` value with an API token.

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

Four sub-items, down from the previous list's twenty questions. Each is a commitment or a
design fact, not a behavior:

| ID            | Question                                                                                                                                 | Why it can't be tested                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2** (gate) | Are the `pt_*` column schemas **public and stable** for 3.11, or internal and subject to change?                                         | Observing today's schema (§3) doesn't tell us whether it may change in 3.12. A hard gate: if internal, `inspect_storage` cannot be built on them and the spec stops. |
| **B2** (half) | Is querying `system.pt_*` the **sanctioned** engine probe, or is there an intended status/catalog endpoint?                              | §3 finds what _works_; only Engineering can say what's supported. Ship-blocking only if the working probe turns out to be one they'd rather we didn't depend on.     |
| **D1** (half) | What does `--user-auth-type oauth` integrate with, does it expose OIDC discovery, and what authorizes DB operations post-authentication? | Design information. Matters for the protocol migration (MCP servers are OAuth 2.1 resource servers as of the 2026-07-28 spec), not for this patch.                   |
| **E1**        | Is there a 3.11 **GA** tag to pin instead of `3.11.0-0.rc.1`, and do the RC digests change at GA?                                        | Partly answers itself once GA publishes — check the registry first; only ask if the tag isn't obvious.                                                               |

Send C2 first. It is the only one that can stop a deliverable.

---

## Closed questions

Kept as a record so nothing looks silently dropped.

| ID     | Resolution                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2** | Duplicate-tag-key response shape — resolved by live verification, recorded in `tests/fixtures/write-errors.ts` (on `main`). `data.error` is the generic `"partial write of line protocol occurred"`; the tag name is under `data.data[].error_message`. Identical on Core 3.11.0-nightly and Enterprise 3.11.0-0.rc.1. Drives P1's resolver design. |
| **B3** | Hybrid-migration detection — `system.upgrade_parquet_node` (per-node status) and `system.upgrade_parquet` (per-file progress) are documented and sanctioned for exactly this. No inference from `pt_*` presence needed.                                                                                                                             |
| **C4** | Compaction-lag detection — `system.pt_compaction_ingest_nodes.compaction_lag` is a direct per-node column; `deferred_snapshot_count` plus `system.pt_compaction_deferred_snapshots.error_message` cover backlog. No heuristic needed.                                                                                                               |
| **F1** | Version anchor — 1.4.0 published 2026-07-30 with PR #69's read-only capability folded in. Sequencing: 1.4.0 → 1.4.1 (this patch).                                                                                                                                                                                                                   |
| **F2** | Target release for `inspect_storage` — admitted on the 1.x line with sign-off, sequenced after 1.4.1 ships.                                                                                                                                                                                                                                         |
| **F3** | `inspect_storage` vs. InfluxDB 3 Cloud support — `inspect_storage` stays this plan's new capability; Cloud support gets its own plan, timed to land before Cloud's GA. Both need the same capability-detection prerequisite.                                                                                                                        |
