---
name: Testing
description: >-
  This skill should be used when the user asks to "run tests", "run the test
  suite", "check test results", "why are tests failing", "debug test failures",
  "add a test", "write a test", "update EXPECTED_TOOL_COUNT",
  "run protocol tests", "run integration tests", "test against InfluxDB",
  "run agent evals", "prepare eval prerequisites",
  or needs to run, analyze, extend, or troubleshoot the MCP server test suite.
version: 0.1.0
---

# Testing the InfluxDB MCP Server

Vitest covers unit tests, MCP protocol tests, scripted fake HTTP scenarios,
and gated live-instance tests. Agent evals additionally exercise a model's tool
use and final answer through a real harness.

## Prerequisites

Build before testing — tests spawn the compiled `build/index.js`, not source:

```bash
pnpm install --frozen-lockfile
pnpm run build
```

### Agent eval prerequisites

When preparing or running agent evals, read
[`AGENT_E2E_TESTS.md`, prerequisites and preflight](../../../AGENT_E2E_TESTS.md#prerequisites-and-preflight)
before launching the harness. Follow all four checks: model access, MCP runner
configuration, fixtures and grading criteria, and evidence capture. Record which
checks succeeded and which remain unverified. Select direct CLI execution or the
shared testbench according to its actual environment requirements; honor any
explicit operator handoff assigned to the task.

Run deterministic tests first to catch protocol failures without spending model
calls. Passing those tests does not complete the agent eval. Complete the eval
only when its evidence is saved and its outcome is reviewed against the pinned
criteria.

## Running Tests

### Protocol tests (no InfluxDB needed)

```bash
pnpm test
```

Runs the configured Vitest suite. Live tests self-skip unless enabled; the
scripted fake HTTP scenarios run locally without a live database or model.

Protocol tests spawn the real server as a child process using the MCP SDK's
`StdioClientTransport`, perform the `initialize` handshake, and assert on
protocol responses. Registration requests
(`tools/list`, `resources/list`, `prompts/list`, `ping`) are answered
entirely from the server's in-memory registrations. Scripted HTTP scenarios also
exercise data operations against the local fake endpoint.

### Integration tests (live InfluxDB)

Start InfluxDB 3 Core via the provided Docker Compose file:

```bash
pnpm run test:infra:up
```

This starts an ephemeral Core container on port `8181` using a static admin
token from `tests/fixtures/admin-token.json` (Docker secrets pattern,
`--object-store memory` — no persistent state).

Run integration tests against it:

```bash
source env.test.example && pnpm run test:integration
```

Tear down when done:

```bash
pnpm run test:infra:down
```

For a custom InfluxDB instance (different port, Enterprise, etc.), set the
env vars directly instead of sourcing the example file:

```bash
INFLUX_TEST_ENABLED=true \
INFLUX_DB_INSTANCE_URL=http://localhost:8281/ \
INFLUX_DB_TOKEN=<your_token> \
INFLUX_DB_PRODUCT_TYPE=enterprise \
pnpm run test:integration
```

Tests call `health_check`, `list_databases`, and `execute_query` through the
MCP protocol.

### Watch mode

```bash
pnpm run test:watch
```

Reruns on file changes. Useful during development.

## What the Tests Cover

| Test                 | What it verifies                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Initialize handshake | Server starts, SDK handshake succeeds, capabilities reported                                               |
| Server version       | Name is `"influxdb-mcp-server"`, version is defined                                                        |
| Tool count           | `tools/list` returns exactly `EXPECTED_TOOL_COUNT` tools                                                   |
| Tool structure       | Each tool has `name`, `description`, `inputSchema` with `type: "object"`                                   |
| Core tool names      | Spot-checks `health_check`, `execute_query`, `write_line_protocol`, `list_databases`, `create_admin_token` |
| Resource URIs        | 4 resources with correct `influx://` URIs                                                                  |
| Resource structure   | Each resource has `name`, `uri`, `description`                                                             |
| Prompt names         | 3 prompts: `list-databases`, `check-health`, `load-context`                                                |
| Ping                 | Server responds to ping                                                                                    |
| Unknown tool error   | Calling nonexistent tool throws `McpError`                                                                 |

## Analyzing Failures

### Expected tool count mismatch

Check the expected counts in `tests/protocol.test.ts` against the tools
advertised for the configured product and profile.

After adding or removing a tool, update the affected assertions and comments in
`tests/protocol.test.ts`. Keep the count expectations there rather than copying
them into this skill.

To find the current count, start the server briefly and check stderr:

```bash
pnpm run build && INFLUX_DB_INSTANCE_URL=http://localhost:19999/ \
INFLUX_DB_TOKEN=fake INFLUX_DB_PRODUCT_TYPE=core \
node build/index.js &
sleep 1 && kill $!
```

Look for: `[MCP] Server initialized with N tools, N resources, N prompts`

### "build/index.js not found"

Run `pnpm run build` first. The `tests/setup.ts` guard fails fast with this
message if the build artifact is missing.

### Initialize handshake timeout

The server process failed to start. Common causes:

- Build is stale after source changes — rebuild with `pnpm run build`
- Missing or invalid env vars — protocol tests use a fake config internally,
  so this usually means `createTestClient` was called with bad overrides

### Health check does not confirm health

Inspect the JSON health and ping outcomes. If an endpoint returns
`credential_cannot_check`, verify a permitted database read before judging
availability. SDK initialization alone does not establish server health. Check:

1. Instance is running: `curl http://localhost:8181/ping`
2. Token is valid
3. `INFLUX_DB_PRODUCT_TYPE` matches the actual instance type

### Tool call error paths

When diagnosing tool call failures, distinguish these paths in
`src/server/index.ts`:

- **Unknown tool name** → `throw new Error(...)` → SDK converts to `McpError`
  → client sees a rejected promise
- **Known tool, validation failure** → returns a structured `invalid_arguments`
  tool result and one failed telemetry event
- **Known tool, handler failure** → returns `isError: true`; read-only query and
  discovery errors include structured access and recovery fields

Protocol tests assert the thrown error path. Integration tests assert the
content-based error path.

## Adding New Tests

### New protocol test

Add to `tests/protocol.test.ts` inside the `describe("MCP protocol compliance")`
block. Protocol tests use the shared `testClient` from `beforeAll`. No InfluxDB
is contacted — only test MCP protocol-level behavior.

### New integration test

Add to `tests/integration.test.ts` inside the
`describe.skipIf(!RUN)("live InfluxDB integration")` block. Call tools via
`testClient.client.callTool({ name: "...", arguments: {...} })` and assert
on the response `content[0].text`.

### Test helper

The `createTestClient(env?)` factory in `tests/helpers/mcp-client.ts` spawns
a real server process and returns a connected MCP `Client`. Override env vars
by passing a partial record. Always call `close()` in `afterAll`.

## Reviewing data-plane and admin changes

When a change adds or modifies a tool that talks to an InfluxDB endpoint
(writes, queries, database/token management), verify the actual API contract
and exercise it against a real instance. Tool descriptions, CHANGELOG entries,
and code comments are not authoritative on their own — confirm them.

### Verify the API contract first

Confirm the HTTP method, path, and request/response shape against both the
InfluxData docs knowledge source and the `influxdata/influxdb` source
(`influxdb3_server/src/http.rs` routing, `influxdb3_types/src/http.rs` structs).

Gotchas that have already bitten this repo:

- Core/Enterprise `update_database` retention is `PUT /api/v3/configure/database`
  with `retention_period` as a duration string (`"60d"`) — not `PATCH`, not
  `retention_period_ns`.
- Core can update retention since v3.2.0 (static docs wrongly say it's immutable).
- Core/Enterprise use `Bearer` auth for data, ping, and health calls. Credentials
  stay opaque; verify JWT behavior separately from API-token behavior.

### Exercise it against a real instance

Admin endpoints (`/api/v3/configure/*`) need appropriate admin access. A passing
`health_check` does not establish authorization to read data or administer the
instance. Run a
self-contained Core for an admin-path test on a free port:

```bash
docker run -d --name mcp-it-core -p 8383:8181 \
  -v "$PWD/tests/fixtures/admin-token.json":/admin-token.json:ro \
  influxdb:3-core influxdb3 serve \
  --node-id local-test --object-store memory \
  --admin-token-file /admin-token.json

INFLUX_TEST_ENABLED=true INFLUX_DB_INSTANCE_URL=http://localhost:8383/ \
INFLUX_DB_TOKEN=apiv3_test INFLUX_DB_PRODUCT_TYPE=core \
pnpm exec vitest run tests/integration.test.ts

docker rm -f mcp-it-core
```

This uses the offline preconfigured admin token in `tests/fixtures/admin-token.json`
(token `apiv3_test`) — the `docker-compose.test.yml` pattern, but on a port you
choose so it does not collide with other local instances.

### Token gotcha

v3 tokens are base64 and can contain `+`, `/`, and `=`. Do not extract one with
`grep -oE 'apiv3_[A-Za-z0-9_-]+'` — it truncates at the first base64 character
and yields an invalid token (the server returns `401 "the request was not
authenticated"`).

## Additional Resources

### Reference Files

- **`.claude/skills/testing/references/test-architecture.md`** — Detailed
  test architecture, design decisions, and how protocol tests work without
  InfluxDB
