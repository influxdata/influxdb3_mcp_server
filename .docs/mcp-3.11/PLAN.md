# Plan — MCP server: InfluxDB 3.11 patch and one new capability

- **Repo under plan:** `influxdata/influxdb3_mcp_server` (standalone TypeScript MCP server)
- **Source ref verified against:** `influxdb3_mcp_server@main` (HEAD `249f612`, `package.json`
  version `1.4.1-test.1`), InfluxDB `3.11.0-0.rc.1`
- **Working branch:** `docs/mcp-3.11-patch-plan`, cut from `main` after the 1.4.0 publish. Supersedes
  `influxdb-3.11-compat-patch`, which was cut from `main` at `9460044` — before 1.4.0 published — and is
  now stale against the version-anchor and sequencing sections below.
- **Updated:** 2026-08-06
- **Status:** review — planning only, implementation not started

## Goal

Two reviewable specs — the next patch release, and one new capability — grounded in the
current server code rather than in the planning drafts' assumptions, plus the list of
questions still to be answered before implementation starts.

## Scope

- **In scope:** InfluxDB 3 Core and Enterprise. The 3.11 compatibility patch (release plan
  workstream 2). One new read-only capability. Remaining verification questions.
- **Out of scope:** The read-only investigation release (workstream 1) — **merged as PR #69
  and released in 1.4.0**; `READONLY_TOOLS` and `INFLUX_MCP_TOOL_PROFILE` are on `main` today
  (`src/tools/index.ts:28`, `:57`). InfluxDB 3 Cloud support (workstream 3) — its own plan,
  see F3. The protocol migration (workstream 5). The in-process Rust service.

## Companion documents

| Document                                                 | Contents                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [`patch-1.4.1-spec.md`](patch-1.4.1-spec.md)             | The next patch — items P1–P7, tests, matrix                         |
| [`inspect-storage-spec.md`](inspect-storage-spec.md)     | The new capability, and the detection work it forces                |
| [`verification-questions.md`](verification-questions.md) | 15 remaining questions, grouped by the instance they're run against |

`verification-questions.md` replaces `open-questions-core-enterprise.md`, which routed most
items to the Core/Enterprise implementing team. All but four sub-items are answerable on a
local instance; only those four still need an Engineering consult.

Upstream drafts this plan executes against: _MCP_Server_Release_Plan.md_ v1.3,
_InfluxDB_3.11_MCP_Impact_Map.md_ v1.2, _AI_Tooling_Brief_v2.md_ v2.2.

## Findings / analysis

### Four draft items settled from the code

| Draft item                                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impact map open item 3 — which write endpoint?                     | **Branches by product type.** Core/Enterprise → `POST /api/v3/write_lp` (`src/services/write.service.ts:85-100`); `clustered` → `POST /api/v2/write` (`:146-159`); cloud-dedicated/serverless → SDK `client.write()`. The 3.11 notes document the 400→503 change for v2 only, so it is not _documented_ to reach Core/Enterprise — but silence about v3 is not evidence about v3. What v3 returns for an unavailable node is question **A1**, and it is observable on an instance. |
| Impact map open item 4 — anything reading Prometheus metrics?      | **No.** No reference to `/metrics` or `prometheus` anywhere in `src/`. 3.11's removal of the per-database `db` label is confirmed no-impact.                                                                                                                                                                                                                                                                                                                                       |
| Impact map 1.1 — does the duplicate-tag-key error reach the model? | **No — it is discarded.** `handleWriteError` (`src/services/write.service.ts:193-214`) replaces the InfluxDB response body with a fixed string for 400/401/403/413/422.                                                                                                                                                                                                                                                                                                            |
| Release plan version anchor                                        | **Resolved, 2026-07-30 — 1.4.0 published.** `npm view @influxdata/influxdb3-mcp-server version` → `1.4.0`. `main` has since moved to `1.4.1-test.1` (`package.json:3`), a no-functional-change prerelease cut to verify the environment-gated release-publish workflow; it published under the npm `prerelease` dist-tag only, not `latest`. See below.                                                                                                                            |

### Two defects the drafts do not mention

- `handleWriteError` has **no 503 arm**, and its fallback interpolates `error.response?.data`
  — normally a parsed object, so the model receives `[object Object]`.
- The cloud SDK throws `statusCode`/`body`, not `error.response.status`
  (`tests/fixtures/error-responses.ts:1-6`), so every status branch misses on those paths and
  they always hit the fallback.

### The version anchor, now settled by publish

**Resolved, 2026-07-30.** `main` published as **1.4.0** — read-only capability (PR #69),
retention policy, and the accumulated Dependabot bumps all shipped in it. `npm view
@influxdata/influxdb3-mcp-server version` now confirms `1.4.0`. The governance gap the previous
version of this section flagged (a feature-adding PR merged onto an unpublished minor with no
version-bump checkpoint) is worth remembering for next time but has no open action here.

`main` has since taken one more commit: a version bump to `1.4.1-test.1`
(`package.json:3`) published under the npm `prerelease` dist-tag to verify the new
environment-gated release-publish workflow (#95, #96) — no functional changes, and it did not
move the `latest` tag on npm or Docker Hub. The 3.11 patch is unrelated to that verification
cut and still targets **1.4.1** as its real, `latest`-tagged release.

### Ship sequencing: settled — this patch ships alone, as 1.4.1

The prior open question — fold the 3.11 patch into the same release as the already-merged
read-only capability, or cut it separately — is moot: 1.4.0 already published without the
patch. This work now proceeds as a standalone 1.4.1, cut on its own branch
(`docs/mcp-3.11-patch-plan`, off `main` post-publish) once P1/P2/P4/P7 land. That still honors
workstream 2's guardrail — "compatibility fixes only, no new tools" — which is what keeping a
vendor-compatibility patch narrow and auditable during a freeze window requires.

### Why `inspect_storage` is the new capability

Operational visibility is what 3.11 actively unlocks: impact map §4 records it as moving from
"unverified" to "feasible on 3.11+ Enterprise", via the new `system.pt_*` tables. The
read-only investigation capability **already shipped** in 1.4.0 (PR #69), and plugin authoring
is post-migration by the brief.

**F3 resolved, 2026-08-05: `inspect_storage` stands.** The choice was originally made under a
third elimination — that the InfluxDB 3 Cloud workstream could not be named in a tracked
artifact — and that restriction has since lifted, so the comparison was reopened on merits and
settled: Cloud support goes in a separate plan, timed to ship before Cloud's GA. It's a full
workstream (new product type, auth, connection plane), not one tool, so it doesn't compete with
`inspect_storage` for this plan's single-capability slot. Both share the capability-detection
prerequisite below, so nothing here is wasted work if Cloud support starts next. The full
comparison is in [`verification-questions.md`](verification-questions.md)'s closed-items table.

`inspect_storage` is also the item that exposes a structural gap: **the server performs no
deployment or version detection at all.** See the capability spec.

## Open questions

**Governance is fully settled — F1, F2, and F3 are all resolved**, so nothing on this plan's
sequencing is waiting on a decision. F1: 1.4.0 published 2026-07-30 with the read-only work
folded in. F2: the freeze admits `inspect_storage` on the 1.x line with sign-off, sequenced
after 1.4.1 ships. F3: `inspect_storage` stays the new capability; Cloud support is a separate
plan. All three are recorded in [`verification-questions.md`](verification-questions.md)'s
closed-items table.

What remains is **15 verification questions**, in
[`verification-questions.md`](verification-questions.md). Eleven of them are answerable on a
local instance and are written as runnable checks grouped by the instance they need; four
sub-items (C2's stability commitment, B2's "is this the sanctioned probe", D1's OAuth design
half, E1's GA tags) are the only ones that still need an Engineering consult. **C2 is the only
one that can stop a deliverable** — if the `pt_*` schemas are internal, `inspect_storage` does
not get built.

## Documentation requirement (each implementation phase)

No phase of this plan is complete on code alone. Before a phase is marked done, update:

- **`README.md`** — anything user-visible the phase changes: tool behavior, error message
  shape, supported-version notes, the tools table. P1/P2/P4 change what a model sees on a
  failed write; that belongs in README wherever write-path errors or 3.11 support are
  described, not just in the CHANGELOG.
- **`docs/adr/`** — a new ADR (next sequence number after `0001-phase1-readonly-query-capability.md`)
  for any decision with lasting shape: the shared error-resolution helper (P1/P2/P4) is an
  architectural decision (query and write paths converge on one error-handling pattern), and
  belongs in an ADR the way the Phase 1 read-only design does. Verification-only items (P3,
  P5's live-matrix half, P6) do not need a new ADR unless they change a decision an existing
  ADR recorded.
- **`CHANGELOG.md`** — already required by `check-versions` CI; not new, listed here so the
  full per-phase checklist is in one place.

## Learnings to promote

- The MCP server's write path and query path handle errors differently; the query path
  (`src/services/query.service.ts:179-204`) is the correct pattern and the write path is the
  outlier. Worth recording as a repo-level gotcha if the shared-helper refactor does not land.
- `research/` is the right home for MCP planning that references pre-release products. When a
  naming restriction is in force it binds _tracked artifacts in any repo_, commit messages
  included — and when it lifts, any decision that rested on it needs re-examining, not just
  the wording. The `inspect_storage` choice above is the worked example.
