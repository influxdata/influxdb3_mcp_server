---
name: Testing
description: >-
  This skill should be used when the user asks to "run tests", "run the test
  suite", "check test results", "why are tests failing", "debug test failures",
  "add a test", "write a test", "update EXPECTED_TOOL_COUNT",
  "run protocol tests", "run integration tests", "test against InfluxDB",
  or needs to run, analyze, extend, or troubleshoot the MCP server test suite.
version: 0.1.0
---

# Testing the InfluxDB MCP Server

Two-layer test suite using vitest. Protocol tests run without InfluxDB.
Integration tests require a live instance and are gated behind an env var.

## Prerequisites

Build before testing — tests spawn the compiled `build/index.js`, not source:

```bash
npm run build
```

## Running Tests

### Protocol tests (no InfluxDB needed)

```bash
npm test
```

Runs `tests/protocol.test.ts` only. Integration tests are skipped
automatically. Expected runtime: <1 second.

These tests spawn the real server as a child process using the MCP SDK's
`StdioClientTransport`, perform the `initialize` handshake, and assert on
protocol responses. No InfluxDB connection is made — protocol requests
(`tools/list`, `resources/list`, `prompts/list`, `ping`) are answered
entirely from the server's in-memory registrations.

### Integration tests (live InfluxDB)

```bash
INFLUX_TEST_ENABLED=true \
INFLUX_DB_INSTANCE_URL=http://localhost:8181/ \
INFLUX_DB_TOKEN=<token> \
INFLUX_DB_PRODUCT_TYPE=core \
npm run test:integration
```

Runs `tests/integration.test.ts` against a real InfluxDB 3 Core or Enterprise
instance. Tests call `health_check`, `list_databases`, and `execute_query`
through the MCP protocol.

### Watch mode

```bash
npm run test:watch
```

Reruns on file changes. Useful during development.

## What the Tests Cover

| Test | What it verifies |
|---|---|
| Initialize handshake | Server starts, SDK handshake succeeds, capabilities reported |
| Server version | Name is `"influxdb-mcp-server"`, version is defined |
| Tool count | `tools/list` returns exactly `EXPECTED_TOOL_COUNT` tools |
| Tool structure | Each tool has `name`, `description`, `inputSchema` with `type: "object"` |
| Core tool names | Spot-checks `health_check`, `execute_query`, `write_line_protocol`, `list_databases`, `create_admin_token` |
| Resource URIs | 4 resources with correct `influx://` URIs |
| Resource structure | Each resource has `name`, `uri`, `description` |
| Prompt names | 3 prompts: `list-databases`, `check-health`, `load-context` |
| Ping | Server responds to ping |
| Unknown tool error | Calling nonexistent tool throws `McpError` |

## Analyzing Failures

### `EXPECTED_TOOL_COUNT` mismatch

The most common failure after code changes. The constant in
`tests/protocol.test.ts` (line 7) must match the actual tool count.

**After adding or removing a tool**, update the constant and comment in
`tests/protocol.test.ts` (the source of truth). Then update the breakdown
below for documentation.

To find the current count, start the server briefly and check stderr:
```bash
npm run build && INFLUX_DB_INSTANCE_URL=http://localhost:19999/ \
INFLUX_DB_TOKEN=fake INFLUX_DB_PRODUCT_TYPE=core \
node build/index.js &
sleep 1 && kill $!
```

Look for: `[MCP] Server initialized with N tools, N resources, N prompts`

The tool count breakdown by category file:
- `help.tools.ts` (2) + `write.tools.ts` (1) + `database.tools.ts` (4)
- `query.tools.ts` (3) + `token.tools.ts` (6) + `cloud-token.tools.ts` (5)
- `health.tools.ts` (1) = **22 total**
- `schema.tools.ts` (4 tools, currently disabled — commented out in
  `src/tools/index.ts`)

### "build/index.js not found"

Run `npm run build` first. The `tests/setup.ts` guard fails fast with this
message if the build artifact is missing.

### Initialize handshake timeout

The server process failed to start. Common causes:
- Build is stale after source changes — rebuild with `npm run build`
- Missing or invalid env vars — protocol tests use a fake config internally,
  so this usually means `createTestClient` was called with bad overrides

### Integration test: "HEALTHY" not found

InfluxDB instance is unreachable or unhealthy. Verify:
1. Instance is running: `curl http://localhost:8181/ping`
2. Token is valid
3. `INFLUX_DB_PRODUCT_TYPE` matches the actual instance type

### Two error paths in the server

When diagnosing tool call failures, note the server has two distinct error
paths (defined in `src/server/index.ts`):

- **Unknown tool name** → `throw new Error(...)` → SDK converts to `McpError`
  → client sees a rejected promise
- **Known tool, handler failure** → caught in try/catch → returns
  `{ content: [{ type: "text", text: "Error: ..." }], isError: true }`

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

## Additional Resources

### Reference Files

- **`.claude/skills/testing/references/test-architecture.md`** — Detailed
  test architecture, design decisions, and how protocol tests work without
  InfluxDB
