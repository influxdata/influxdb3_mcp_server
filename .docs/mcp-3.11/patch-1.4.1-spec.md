# Patch spec — v1.4.1: 3.11 compatibility and write-path error fidelity

- **Repo:** `influxdata/influxdb3_mcp_server`
- **Verified against:** `main` HEAD `cc8bce2`, InfluxDB `3.11.0-0.rc.1`
- **Branch:** `docs/mcp-3.11-patch-plan`, off `main` post-1.4.0-publish
- **Updated:** 2026-07-31
- **Status:** review — planning only, implementation not started
- **Executes:** release plan workstream 2; impact map §1

## Summary

Seven items. The substantive one is that InfluxDB's own error text is discarded on the write
path, which defeats the impact map's central 3.11 requirement — that a duplicate-tag-key
rejection reach the model as an actionable error. The rest are a status-code gap, an error
shape mismatch, an auth-scheme bug, two verification-only checks, and one critical
packaging fix.

Version rationale is in [`PLAN.md`](PLAN.md). 1.4.0 published 2026-07-30; this patch is 1.4.1,
final — no retitle pending.

**Guardrail (release plan workstream 2): compatibility fixes only. No new tools.**
`EXPECTED_TOOL_COUNT` moved from 22 to 27 when PR #69's read-only capability merged
(`tests/protocol.test.ts:7`) — that is 1.4.0 content, already published, not part of this
patch. This patch holds the count at 27; it adds none of its own.

## Phases, live testing, and documentation checkpoints

Two phases, split on whether the fix touches a live-instance-only code path. Both phases —
including Phase A, even though its unit tests need no live instance — require live harness
evidence before being marked done. Unit tests prove the handler logic; only a live instance
proves the model actually receives the fixed error text. Per the plan's
[documentation requirement](PLAN.md#documentation-requirement-each-implementation-phase),
neither phase is done until `README.md` and, where a lasting architectural decision was made,
a new `docs/adr/` entry are updated alongside it — not deferred to a follow-up.

**Live testing requirement (both phases).** Before a phase is marked done, run it against a
live 3.11 instance by one of:

- **`docs-tooling/docs-agent/testbench`** — the sandboxed multi-agent runner that executes
  `AGENT_E2E_TESTS.md` cases against a live `docker-compose` InfluxDB 3 instance and produces
  graded results (see [`../../e2e-results/`](../../e2e-results/) for the existing format:
  `result: passed | needs_review | failed` per case). Preferred when the fix has, or can get,
  an `AGENT_E2E_TESTS.md` case — P1's duplicate-tag-key case is exactly this shape.
- **Manual** — a live 3.11 Core/Enterprise instance (per the test matrix below), driven by
  hand or by an ad hoc agent session, with the transcript or command output captured in the
  phase's completion notes. Acceptable where a testbench case doesn't fit cleanly (e.g. P7's
  packaging check, which is `npm i --omit=dev` against the published tarball, not an agent
  prompt).

Either way, the evidence — testbench graded run or manual transcript/output — is what the
`release` skill checks for before publish; see `.claude/skills/release/SKILL.md`.

- **Phase A — code fixes: P1, P2, P4, P7.** These land the shared error-resolution helper and
  the packaging fix. Live evidence: a duplicate-tag-key write (`m,t=a,t=a f=1i`) against a
  live 3.11 instance, confirming the model-facing error names the tag (new `AGENT_E2E_TESTS.md`
  case or manual run); a 503 case if a stopped-node instance is reachable (else defer to Phase
  B, since it needs A1 answered anyway); `npm i --omit=dev` against the built tarball for P7.
  On completion: add the ADR for the shared write/query error-handling pattern; update
  `README.md` wherever it describes write-path errors or install/packaging; add the
  duplicate-tag-key case to `AGENT_E2E_TESTS.md` if testbench was used, and commit its graded
  result under `e2e-results/`.
- **Phase B — live-instance verification: P3, P5 (reporting-bug fix), P6, plus the test
  matrix.** P5's reporting-bug fix is code (health check must require an actual successful
  response); P3/P6 and the matrix are confirm-only, and are themselves the live testing this
  phase requires — no separate evidence step. Run the full matrix below through testbench where
  a case exists (health check, schema listing) and manually otherwise (stopped-node 503,
  PachaTree hybrid state). On completion: update `README.md`'s version-support notes with what
  the matrix confirmed (3.11 Core/Enterprise, PachaTree vs. Parquet); commit the matrix's graded
  results under `e2e-results/`; no new ADR expected unless a matrix result overturns an existing
  one.

---

## P1 — Preserve InfluxDB's error body on the write path

**Priority: highest. This is the 3.11 item.**

3.11 rejects writes with a duplicate tag key up front (`m,t=a,t=a f=1i`), replacing a crash
loop with a clean rejection whose body names the duplicated tag. The impact map requires that
message reach the model, and states that a generic "write failed" is not sufficient.

Today it cannot. `handleWriteError` (`src/services/write.service.ts:193-214`) matches on
`error.response?.status` and, for **400, 401, 403, 413, and 422**, throws a fixed string with
the response body dropped entirely. A duplicate-tag-key rejection arrives as a 400 and reaches
the model as `Bad request: Invalid line protocol format or parameters` — no tag name, nothing
to act on.

**Fix.** The correct pattern already exists in the same codebase, in `handleQueryError`
(`src/services/query.service.ts:629-653`): resolve the message through
`data.message` → `data.error` → string body → `statusText` → `message`, then prefix per status
so the body always survives. Apply the same resolution on the write path.

Prefer lifting the resolution into a shared helper over copying it — the two handlers drifting
apart is what produced this defect. `src/services/token-management.service.ts:81-83`,
`database-management.service.ts:751`, and `cloud-token-management.service.ts:246` already
preserve bodies with their own variants, so a single helper has several callers.

**Closes:** impact map 1.1.

## P2 — Add a 503 arm; stop rendering objects as `[object Object]`

Neither handler has a 503 branch. `handleWriteError`'s fallback interpolates
`error.response?.data` directly; when the body is parsed JSON — the normal case — the model
receives `Failed to write data to database 'x': [object Object]`.

**Fix.** Add a 503 arm phrased as retryable, so a model can distinguish "try again" from
"your request is wrong" — the distinction the impact map calls out as the point of the status
change. Serialize non-string bodies rather than interpolating them.

**Related:** impact map 1.2.

## P3 — Verify what v3 returns for a stopped node

Impact map 1.2 is narrower than written. The 3.11 notes document the 400→503 change for the
**v2** write API, and the five-minute code check it calls for is now done: Core and Enterprise
use `POST /api/v3/write_lp` (`src/services/write.service.ts:85-100`), not v2. Only the
`clustered` product type uses `/api/v2/write` (`:146-159`), and Clustered is a separate
product on its own release train.

So the documented change does not reach the Core/Enterprise path. What remains open is what
**v3** returns for a stopped node on 3.11 — unknown, and answerable only on a test instance.

**Action:** verify on the matrix below, then close the item. Blocks nothing in P1/P2, since
those fix the handler generically. See question **A1**.

## P4 — Normalize the cloud SDK error shape

`@influxdata/influxdb3-client` throws `HttpError` carrying `statusCode`, `statusMessage`,
`body`, and `json` — not `error.response.status`. The fixture header at
`tests/fixtures/error-responses.ts:1-6` records exactly this. Every status branch in
`handleWriteError` therefore misses on cloud-dedicated and cloud-serverless, and those paths
always fall through to the fallback with only `error.message`.

**Fix.** Normalize both shapes to one internal form before branching. Strictly outside the
Core/Enterprise scope, but it is the same function P1 and P2 rewrite, and leaving it means
those fixes only half-land.

## P5 — Health-reporting bug (auth half already fixed by PR #69)

The auth-scheme mismatch this item originally described is **fixed.** `/ping` and `/health`
used to hardcode `Authorization: Token <token>` while `http-client.service.ts` sent `Bearer`
for every product type except cloud-serverless. PR #69 merged that fix to `main` at `9460044`
(2026-07-28): `createAuthHeader()` (`src/services/base-connection.service.ts:79-85`) now
returns `Bearer` for every type except `CloudServerless`, matching `http-client.service.ts`'s
`createAuthHeaders()`. `tests/base-connection-auth.test.ts` (new in the same merge) covers it.
Nothing left to do here — confirm on the live matrix per question **D2**, but no code change.

**What remains open is the other half, untouched by that merge.**
`src/tools/categories/health.tools.ts:44` treats a merely-constructed client as success:
`getHealthStatus()` and `ping()` both fail silently into empty `catch` blocks, but
`if (connectionInfo.isDataClientInitialized) hasAnySuccess = true;` still flips the result to
healthy regardless. `health_check` can report `✅ HEALTHY` against a server that is actually
unreachable. This is impact map 1.5 ("health check against 3.11 — low risk, include in the
test pass"); the finding is that the risk was never 3.11-specific — this reporting bug
predates and is unrelated to the auth fix.

**Fix.** `hasAnySuccess` should require an actual successful health or ping response, not
merely a constructed client.

## P6 — Verification only, no code change expected

- **Query and schema tools against PachaTree** (impact map 1.3). Confirm result structure,
  data types, and error wording are unchanged from Parquet.
- **New system tables in schema listings** (impact map 1.4). `get_measurements` and
  `get_measurement_schema` filter on `table_schema = 'iox'`
  (`src/services/query.service.ts:753` and `:1010`), so the five new `system.pt_*` tables
  are excluded by construction on Core/Enterprise — they should neither appear nor cause an
  error. Confirm on a live instance; see question **C3**.

## P7 — Critical packaging fix to fold in

`zod` is declared in `devDependencies` (`package.json:77`) but imported at runtime by
`src/tools/index.ts` and every `src/tools/categories/*.tools.ts`. A clean
`npm i --omit=dev` — or any consumer installing the published package — breaks.

This qualifies as a critical fix under the freeze and should ride along rather than wait.

---

## Tests

**There is currently no test of any kind covering `handleWriteError`.** The recorded fixtures
and the unit tests (`tests/query-error-core.test.ts`, `tests/query-error-serverless.test.ts`)
target `handleQueryError` only. That gap is why this defect survived to a release deadline.

Add, mirroring the existing query-error unit tests:

1. One case per status arm, asserting the InfluxDB body text survives into the thrown message.
2. **The duplicate-tag-key case** — write `m,t=a,t=a f=1i` and assert the model-facing error
   names the duplicated tag. This is the assertion impact map 1.1 explicitly requires.
3. A 503 case asserting retryable phrasing.
4. A cloud `HttpError`-shaped case (P4), asserting the status branch is actually reached.

**Fix the integration harness too.** `npm run test:integration` runs only
`tests/integration.test.ts` (`package.json:29`), so `tests/query-error-integration.test.ts`
never runs against a live instance in CI — and under `npm test` it self-skips for want of
`INFLUX_TEST_ENABLED`. It has been dead in both paths.

## Test matrix

Permanent, per impact map §2. This patch is the first release to run it.

| Row | Instance | Purpose |
|---|---|---|
| 1 | Fresh 3.11 Enterprise | PachaTree by default, no flags — where every new customer lands |
| 2 | Enterprise upgraded with `--upgrade-pacha-tree` | Hybrid: old data in Parquet, new in PachaTree, one query spanning both. Where surprises are likeliest |
| 3 | 3.11 Core | Parquet-only, unchanged — the no-regression baseline |

Image digests for the RC are in the 3.11 internal notes. Pin GA tags once published; see
question **E1**.

## Out of scope

- **LoadCapture** — neither the server nor the Claude skill may mention it until its user
  guide publishes and Support confirms capacity.
- **Authentication work** — `--user-auth-type` does not change how tokens work on the HTTP API
  this server uses. Whether it could later back MCP auth belongs to the migration.
- **Storage-engine introspection** — new capability, see
  [`inspect-storage-spec.md`](inspect-storage-spec.md).
- **Startup configuration changes** — the 44 renamed `--pt-*` flags, env var renames, size-flag
  parsing, the six deleted flags. The server starts no processes and sets none of these.
  Confirmed no-impact; recorded so nobody re-checks.

## Related work outside this repo

The Claude skill teaches `influxdb3 serve` flags and environment variables — exactly the
surface 3.11 renames without aliases. A user following its current guidance against 3.11 gets
a server that fails to start. Separate repo, same deadline (impact map §6).
