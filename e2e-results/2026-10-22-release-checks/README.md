# Read-only release checks

The server and test changes pass the local suite and both live suites.
The two-client agent comparison remains unverified.

Run on 2026-10-22 UTC from `478d67d7c3219efea7e6ebfc3a65ab9d48eef34c`
with the working-tree changes to `src/services/help.service.ts`,
`tests/query-format-live.test.ts`, `tests/README.md`, and `vitest.config.ts`.
These results describe that candidate, not an unchanged PR head or a released package.
The runtime was Node.js 26.9.0 with Vitest 4.1.11.

## Changes verified

- Live test files run sequentially to avoid concurrent scratch databases
  exceeding Core's five-database limit on the shared testbench.
  Fake-server tests retain file parallelism.
- The format live test skips explicitly when `INFLUX_TEST_DATABASE` is unset.
- `get_help` explains that Enterprise's 401 response cannot distinguish expiry,
  malformed JWTs, or a node that does not accept the JWT.
  It also explains that Auditor can list databases but cannot query tables.
  Error codes, raw messages, and recovery classifications remain unchanged.

## Results

| Check | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm run lint` | Passed |
| Prettier on changed files | Passed |
| `node scripts/check-versions.js` | Passed, version 1.4.2 with Unreleased present |
| `npm test` | 286 passed, 20 skipped; 23 files passed, 5 skipped |
| Full live suite, Core 3.12.1 | 258 passed, 48 skipped; 25 files passed, 3 skipped |
| Full live suite, Enterprise 3.12.1 | 258 passed, 48 skipped; 25 files passed, 3 skipped |
| Unset `INFLUX_TEST_DATABASE`, format live test on each product | 1 skipped, exit 0 on each |
| Enterprise Member JWT | Passed health, database list, table list, and SQL reads |
| Enterprise Auditor JWT | Passed health and database list; table list and SQL returned expected 403 classifications |
| Enterprise smoke-reader JWT, preview custom role | Passed health and reads; database list contained only `smoke` |
| Expired JWT | Skipped; no expired credential supplied |
| Built server `get_help` over stdio | Returned the JWT and query-permission guidance |
| Claude and Codex comparison | Preflight blocked by unauthenticated 1Password; no agent launched |

The live suites used admin credentials with `INFLUX_TEST_ENABLED=true`,
`INFLUX_TEST_DATABASE=smoke`, and the matching `INFLUX_DB_PRODUCT_TYPE`.
Core used host port 8282; Enterprise node0 used host port 8181.
Fresh JWTs came from signing in the existing test users on Enterprise node0.
The JWT run supplied `INFLUX_TEST_JWT_MEMBER`, `INFLUX_TEST_JWT_AUDITOR`,
and `INFLUX_TEST_JWT_SMOKE` to `tests/discovery-recovery-protocol.test.ts`.
That file reported 3 passed and 31 skipped in live mode.

Full live output is in `/tmp/mcp-release-verification/`:
`suite-core.txt`, `suite-enterprise.txt`, `jwt-live.txt`,
`format-unconfigured-core.txt`, and `format-unconfigured-enterprise.txt`.
The runner checked each output for the supplied secret values and credential patterns before writing it.
No credential match was found.

The initial sandboxed fake-server run could not establish local connections
and timed out. The unrestricted rerun passed, including the final rebuilt candidate.
The live suite runs and other checks listed above exited 0.

## Remaining release checks

- Run the expired-JWT case when an expired credential is available.
  This run does not claim live expiry coverage.
- Run and grade the 12-case agent comparison under both Claude and Codex,
  three repetitions per case and server profile, for 90 runs.
  The dry run reached an `op-session: not authenticated` preflight error.
  Its final exit 0 only described the rendered plan and does not establish test success.
  Regrade the completed results and compare them with the earlier baseline
  and the `195c7cd` set. The runner's recorded Codex `model: sonnet` is not
  reliable model identity.
- Update the PR's verification text with the observed JWT and live-suite results.
  Identify the candidate revision used for each result.
- Keep authoritative catalog metadata, tombstones, server timeouts,
  backpressure, and failures after streamed rows begin unverified until observed live.
  Synthetic scenarios do not establish those product behaviors.

Assigned server and test fixes passed their checks.
Overall release verification remains incomplete because the agent comparison
and expired-JWT case have not run.
No generated specifications, schemas, or generated product documentation changed.
The modified source, test configuration, test documentation, and this manually
written result summary are ordinary files, so source-generation checks are not applicable.
