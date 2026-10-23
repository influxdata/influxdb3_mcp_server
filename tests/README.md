# Test suite

Run `pnpm run build` first — tests spawn the compiled `build/index.js`.

| Command                     | Runs                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `pnpm test`                 | Everything; live-instance tests self-skip                          |
| `pnpm run test:integration` | Every file matching `integration`, with `INFLUX_TEST_ENABLED=true` |

## Basic testing requirements

Install dependencies with `pnpm install --frozen-lockfile` and build the candidate before running tests.
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

## Protocol tests against a fake InfluxDB

The read-only query tests call tools the way a client does: over stdio, with
the built server pointed at a scripted fake InfluxDB HTTP endpoint
(`helpers/fake-influxdb.ts`). With `INFLUX_TEST_ENABLED` set,
`helpers/backend.ts` skips the fake and points the same tests at the live
instance, seeding the `mcp_test_trust` database at fixed timestamps so
re-runs overwrite rather than append.

Each test name starts with its backend:

- `[both]` runs on the fake, and on the live instance under `INFLUX_TEST_ENABLED`.
- `[fake-only: <why>]` skips under `INFLUX_TEST_ENABLED`, for states a live
  server can't produce on demand, such as a stream that fails after two rows.
- `[live-only]` needs a real server.

Scripted responses are named scenarios: query scenarios in
`fixtures/influxdb-scenarios.ts`, and discovery, access, and recovery
scenarios in `fixtures/discovery-scenarios.ts`. The fake answers each request
with the first scenario that matches it. Each scenario records the products
and version it stands for and where its response came from. A
`source-inspection` scenario is a guess until a live run confirms it. When a
live run disagrees, update the scenario from the observed response and change
its provenance in the same change. Add every scenario to one of the lists
that `scenario-contract.test.ts` checks.

Cloud Dedicated and Cloud Serverless SQL go through the Flight client, which
the fake can't serve. Their cases stay in `query-routing.test.ts`, with
stubbed clients.

### Contracts

| Contract              | Test                                                                    | Checks                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Response envelope     | `expectValidEnvelope` in `helpers/envelope.ts`, run by every `callTool` | Every read-only tool response against `schemas/read-only-response.schema.json`, on both backends                                                                                                                                                                                   |
| Telemetry event       | `expectValidTelemetry` in `helpers/envelope.ts`                         | Each logged tool call against `schemas/telemetry-event.schema.json`                                                                                                                                                                                                                |
| Fake-server scenarios | `scenario-contract.test.ts`                                             | Each scenario against the pinned OpenAPI excerpt for each of its products (`fixtures/openapi/`, refreshed by `scripts/snapshot-protocol-openapi.py`). A scenario outside the spec must say why in `provenance.outside_spec`; the test reports it in its output instead of failing. |

To run the protocol tests against a testbench target:

```bash
pnpm run build
INFLUX_TEST_ENABLED=true \
INFLUX_DB_INSTANCE_URL=<url> \
INFLUX_DB_TOKEN=<token> \
INFLUX_DB_PRODUCT_TYPE=<core|enterprise> \
pnpm exec vitest run tests/query-completeness.test.ts tests/query-format.test.ts tests/query-safety-protocol.test.ts
```

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

Live test files run sequentially because they create scratch databases.
On a shared Core testbench, parallel files can exceed the five-database limit.
The default fake-server run keeps file parallelism enabled.

To run the full suite against a seeded Core or Enterprise testbench, set
`INFLUX_DB_INSTANCE_URL`, `INFLUX_DB_TOKEN`, and `INFLUX_DB_PRODUCT_TYPE`, then run:

```sh
INFLUX_TEST_ENABLED=true INFLUX_TEST_DATABASE=smoke pnpm test
```

`query-format-live.test.ts` skips when `INFLUX_TEST_DATABASE` is unset.
The other enabled live files still run.

For Enterprise user JWT checks, supply any of `INFLUX_TEST_JWT_MEMBER`,
`INFLUX_TEST_JWT_AUDITOR`, `INFLUX_TEST_JWT_SMOKE`, and `INFLUX_TEST_JWT_EXPIRED`
through the environment, then run:

```sh
INFLUX_TEST_ENABLED=true INFLUX_TEST_DATABASE=smoke \
pnpm exec vitest run --reporter=verbose tests/discovery-recovery-protocol.test.ts
```

Each JWT case skips independently when its credential is unset.
The smoke-reader case needs the preview custom role with read access only to `smoke`.
An expired-JWT skip does not establish expiry handling against a live server.

### Isolated P3 metadata fixtures

`tests/p3-metadata-live.test.ts` creates its own database, declared tables,
and expiring app token with the configured Core or Enterprise admin credential.
It checks server-reported column roles, implicit and Enterprise explicit schema
mode, active and soft-deleted tables, and scoped Enterprise catalog denial.
It revokes the app token and hard-deletes its database after each fixture.
Core needs one free database slot; the test never deletes shared fixtures to make room.

```sh
INFLUX_TEST_ENABLED=true pnpm exec vitest run tests/p3-metadata-live.test.ts
```

Set `INFLUX_TEST_P3_OBSERVATIONS` to a file path to append raw fixture metadata
requests and responses, including `/ping` version evidence.
Token creation responses are excluded, and supplied credentials are redacted.
The ordinary test suite checks metadata-source fallback with the fake server.

```bash
pnpm run test:infra:up
source env.test.example && pnpm run test:integration
pnpm run test:infra:down
```
