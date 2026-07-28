# Test suite

Run `npm run build` first — tests spawn the compiled `build/index.js`.

| Command                    | Runs                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `npm test`                 | Everything; live-instance tests self-skip                          |
| `npm run test:integration` | Every file matching `integration`, with `INFLUX_TEST_ENABLED=true` |

## Conventions

Three kinds of test live here, distinguished by how they are marked.

**Active** — asserts what the code does today and must keep doing. Green.

**`describe.skip("[P<n>] …")`** — acceptance criteria for a planned change that
has not landed. Skipped so CI stays green, but each one fails against current
code, so un-skipping is all that is needed to drive the work. Where an
acceptance test has a paired active test asserting the opposite, the pair is
deliberate: the active test goes red when the fix lands, which forces the stale
characterization to be deleted rather than left behind. Two acceptance tests are
no-regression guards that pass both before and after, and say so in a comment.

**`it.todo(…)`** — a test that cannot be written yet because the answer it would
assert against is unknown. Each names the question ID and what unblocks it.
These appear in every vitest run, so the open list stays visible in CI output.

## Coverage for the write-path error and packaging fixes

| Bug                                            | Tests                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Write path drops the InfluxDB error body        | `write-error-core.test.ts`, `write-error-cloud.test.ts` |
| Which endpoint each product type writes to      | `write-routing.test.ts`                              |
| `zod` is a runtime dependency, declared as dev  | `packaging.test.ts`                                   |
| `ping()` version/build header passthrough       | `base-connection-ping.test.ts`                        |
| `write_line_protocol` contract, error surfacing | `protocol-write.test.ts`                              |

None of these are version-gated — they're bugs in the current server,
independent of which InfluxDB release is on the other end.

## Live-instance gates

`INFLUX_TEST_ENABLED` covers any live instance; tests under it must pass on the
CI Core container.

```bash
npm run test:infra:up
source env.test.example && npm run test:integration
npm run test:infra:down
```
