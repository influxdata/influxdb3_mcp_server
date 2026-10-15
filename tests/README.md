# Test suite

Run `npm run build` first — tests spawn the compiled `build/index.js`.

| Command                    | Runs                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `npm test`                 | Everything; live-instance tests self-skip                          |
| `npm run test:integration` | Every file matching `integration`, with `INFLUX_TEST_ENABLED=true` |

## Basic testing requirements

Install dependencies with `npm ci` and build the candidate before running tests.
Unit and protocol tests, including scripted fake HTTP scenarios, require no
model access or live database. Live tests require the intended product version,
credentials, and fixtures; select tests appropriate to the credential's scope.

For agent evals, complete the
[prerequisites and preflight](../AGENT_E2E_TESTS.md#prerequisites-and-preflight):
verify model access, MCP runner configuration, fixtures and grading criteria,
and evidence capture. The runbook also distinguishes direct CLI execution from
the shared container testbench. Build or protocol-test success alone does not
establish agent-eval success.

## Conventions

Three kinds of test live here, distinguished by how they are marked.

**Active** — asserts what the code does today and must keep doing. Green.

**`describe.skip("[P<n>] …")`** — acceptance criteria awaiting implementation or
an unavailable fixture or observation. Read the named blocker before enabling
one. Some are executable regression tests; others are placeholders whose
assertions still need to be written. An enabled placeholder with no assertions
does not verify the criterion. Replace stale characterizations when behavior
changes and record unavailable live checks as unverified.

**`it.todo(…)`** — a test that cannot be written yet because the answer it would
assert against is unknown. Each names the question ID and what unblocks it.
These appear in every vitest run, so the open list stays visible in CI output.

## Coverage for the write-path error and packaging fixes

| Bug                                             | Tests                                                   |
| ----------------------------------------------- | ------------------------------------------------------- |
| Write path drops the InfluxDB error body        | `write-error-core.test.ts`, `write-error-cloud.test.ts` |
| Which endpoint each product type writes to      | `write-routing.test.ts`                                 |
| `zod` is a runtime dependency, declared as dev  | `packaging.test.ts`                                     |
| `ping()` version/build header passthrough       | `base-connection-ping.test.ts`                          |
| `write_line_protocol` contract, error surfacing | `protocol-write.test.ts`                                |

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
