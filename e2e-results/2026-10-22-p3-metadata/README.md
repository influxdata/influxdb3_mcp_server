# P3 metadata observations and verification

P3's isolated metadata and tombstone acceptance tests pass on Core and Enterprise 3.12.1.
The implementation now reports authoritative column roles, schema mode, and deletion status when readable.
It preserves readable columns and samples when optional metadata is unavailable.

The candidate starts at `f7d19b6` with the P3 working-tree changes.
It is not a published package or an unchanged PR head.
[artifact-revisions.json](artifact-revisions.json) records source and output SHA-256 values for this run.
Runtime: Node.js 26.9.0, TypeScript 5.9.3, and Vitest 4.1.11.

## Live observations

| Target | Version and revision | Database modes | Credential coverage |
| --- | --- | --- | --- |
| Core, host port 8282 | 3.12.1, `692ea4a994` | Implicit | Admin reads; temporary named admin token for fixture writes |
| Enterprise node0, host port 8181 | 3.12.1, `d86454e254` | Implicit and explicit | Admin reads; database-scoped resource token for writes and scoped reads |

- Database-local `system.influxdb_schema` returns `tag` and `time` roles.
  It identifies the fixture's field types as `float`, `integer`, `uinteger`, `boolean`, and `string`.
  These roles remain readable with the database-scoped Enterprise token.
  A string field and a string tag remain distinguishable without guessing from Arrow types.
- In `_internal`, `system.databases.schema_mode` reports the configured mode.
  `system.tables.deleted` distinguishes active tables from the soft-deleted table.
  A filtered join returns both values for the requested database and table.
- The Enterprise database-scoped token gets an empty HTTP 403 when querying the internal catalog.
  That denial does not prevent reading database-local roles or samples.
- Soft deletion retains the table schema and renames the table to `retired-YYYYMMDDTHHMMSS`.
  The renamed table remains visible and queryable in these fixtures, with `deleted: true` in the catalog.
  An active table deliberately named `metrics-20260101T000000` has `deleted: false`.
  A timestamp-shaped name alone does not establish deletion.

Raw fixture requests and responses, including `/ping` and the scoped 403, are in
[core-observations.jsonl](core-observations.jsonl) and
[enterprise-observations.jsonl](enterprise-observations.jsonl).
Token creation responses are excluded; credential values are redacted before capture.
Saved outputs passed a credential-pattern scan.

## Implementation and verification

`describe_table` and `investigate_database` retain the existing `source` values.
Server-observed schema mode and deletion use `source: "server"`, with a `catalog` field naming their source table.
Columns use `source: "server"` when `system.influxdb_schema` establishes their role.
An unavailable role source preserves unknown categories and time-name inference.
Unavailable or unfamiliar catalog metadata stays `unknown` and produces a warning.
The metadata queries use the caller's credential; they never substitute an admin credential.

Investigation preserves this evidence through successful and failed sampling.
It keeps soft-deleted and similarly named active tables visible.
Authoritative deletion evidence overrides the name-only warning.
Without that evidence, both the prior numeric suffix and the observed UTC suffix remain advisory.
The request budget now reserves three schema requests per table, plus two for sampling and its optional history lookup.
`list_tables` retains its conservative metadata without additional catalog requests.

| Check | Result |
| --- | --- |
| P3 tests before production changes | Core: 2 failed; Enterprise: 6 failed, demonstrating unknown metadata and roles |
| `npm run build` | Passed |
| `npm run lint` | Passed |
| Prettier on changed source, tests, and documentation | Passed |
| `node scripts/check-versions.js` | Passed |
| `npm test` | 297 passed, 25 skipped; 24 files passed, 6 skipped |
| Full live suite, Core | 271 passed, 51 skipped; 27 files passed, 3 skipped |
| Full live suite, Enterprise | 275 passed, 47 skipped; 27 files passed, 3 skipped |
| P3-specific live cases | Core: 2 passed, 4 inapplicable cases skipped; Enterprise: 6 passed |
| Cleanup verification | No active P3 database or temporary P3 app token remained on either target |

The first integrated run exposed a stale Phase 1 assertion requiring `temp` to be unknown.
That assertion now checks server-provided field and tag roles.
The final full live suites include that correction.

The fake-server cases cover unavailable sources, unfamiliar successful responses,
catalog parameter binding, active names resembling tombstones, and preservation
of authoritative metadata when sampling fails.
The named live scenarios also pass the pinned OpenAPI scenario contract.
Partial per-table permission failures remain fake-only; the live scoped token denies the internal database as a whole.

Full live outputs are in [core-live-suite.txt](core-live-suite.txt) and
[enterprise-live-suite.txt](enterprise-live-suite.txt).
[cleanup.json](cleanup.json) records the final active-database and temporary-token checks.
The fixture requested immediate hard deletion of its databases; physical storage reclamation was not measured.

## Reproduce

Use the pinned pnpm version for the current checkout.
The npm commands in the results table record the original run before the pnpm migration.

Configure `INFLUX_DB_INSTANCE_URL`, `INFLUX_DB_PRODUCT_TYPE`, and an admin
`INFLUX_DB_TOKEN` for one test target, without printing the credential.
Core needs one free database slot.
The fixture uses unique names, creates an expiring app token, and cleans up its own resources.

```sh
pnpm install --frozen-lockfile
pnpm run build
INFLUX_TEST_ENABLED=true \
INFLUX_TEST_P3_OBSERVATIONS=/tmp/p3-observations.jsonl \
pnpm exec vitest run --reporter=verbose tests/p3-metadata-live.test.ts
```

Repeat for the other product.
For the full live suite, also set `INFLUX_TEST_DATABASE=smoke` and run `pnpm test`.

## Completion record

| Field | Record |
| --- | --- |
| Applicability | Test transcripts and raw metadata observations are generated evidence. Product source, tests, fixtures, and documentation are hand-written; no generated product documentation or schemas changed. |
| Artifact | The two observation files, two live-suite outputs, cleanup output, and revision manifest beside this report. |
| Authoritative source | `tests/helpers/p3-fixture.ts`, `tests/p3-metadata-live.test.ts`, the full test suite, and the built MCP server under `src/services/`. Durable behavior corrections are in source and tests. |
| Revision | Base `f7d19b6` plus uncommitted P3 changes; exact input and output digests are in the revision manifest. Product revisions are listed above. No later commit is implied. |
| Source correction | Present in the inspected working tree. The P3 placeholder is replaced by executable live tests. |
| Reproduction | Commands above, with the recorded runtime and dependency versions. Admin credentials and disposable test targets are required external inputs. |
| Verification | Final local and full live suites pass against the recorded candidate. The current response envelope schema validates the new outputs. |
| Remaining dependencies | Two-client agent comparison, expired-JWT coverage, P4 server timeout/backpressure evidence, and review/publication remain separate work. |
| Assigned-task result | P3 isolated fixtures, live observations, justified metadata changes, and scoped fallback are confirmed. |
| Overall outcome | P3 work is complete for the observed targets; the broader release plan remains incomplete. |
