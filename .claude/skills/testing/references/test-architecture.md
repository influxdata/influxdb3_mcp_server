# Test Architecture

## Design Decisions

### Process spawning over in-process testing

The tests spawn `build/index.js` as a child process rather than importing
`createServer()` directly. Reasons:

1. **`dotenv.config()`** runs at import time in `src/config.ts`, making
   in-process env manipulation fragile
2. **Stdio transport initialization** is part of the real startup path —
   spawning tests the actual entry point
3. **Dependency breakage** from security patches or version bumps affects
   the compiled output, not the source. Spawning the built artifact catches
   these failures.

### Protocol tests need no InfluxDB

The server starts and registers all tools, resources, and prompts in memory
during `createServer()`. MCP list/ping requests read from these in-memory
arrays without contacting InfluxDB.

The trick: `createTestClient()` passes a fake config:

```typescript
const BASE_ENV = {
  INFLUX_DB_INSTANCE_URL: "http://localhost:19999/",  // nothing listens here
  INFLUX_DB_TOKEN: "test-token-not-used",
  INFLUX_DB_PRODUCT_TYPE: "core",
};
```

This passes `validateConfig()` (which only checks that the vars exist, not
that they're reachable). The `InfluxDBClient` constructor succeeds because
it's lazy — no connection is made until a query or write is executed.

### Tool count as a regression signal

`EXPECTED_TOOL_COUNT` is the primary regression gate for dependency updates.
When a dependency bump silently breaks a tool import (e.g., a Zod version
change causes a tool's `zodSchema` definition to fail), the server may
initialize with fewer tools than expected. The count assertion catches this.

The count also appears in the server's stderr init message:
`[MCP] Server initialized with N tools, N resources, N prompts`

### Integration tests gated by env var

`describe.skipIf(!process.env.INFLUX_TEST_ENABLED)` ensures integration tests
never run accidentally. The vitest file is always compiled (catching type
errors) but executes 0 tests unless the gate is set.

## Test File Responsibilities

### `tests/setup.ts`

Vitest setup file (runs before all tests). Asserts `build/index.js` exists.
Fails fast with a clear message rather than letting tests produce confusing
spawn errors.

### `tests/helpers/mcp-client.ts`

Factory function `createTestClient(env?)`:

1. Resolves `build/index.js` path
2. Creates `StdioClientTransport` with the server command, args, and env
3. Creates MCP `Client`, calls `connect()` (performs initialize handshake)
4. Returns `{ client, close }` — the `close()` function terminates the
   child process

The `stderr: "pipe"` option prevents server diagnostic output from leaking
into the test runner's stdout.

### `tests/protocol.test.ts`

Single `describe` block with shared `testClient` lifecycle (`beforeAll`/
`afterAll`). Tests are stateless and order-independent. The server process
lives for the entire describe block (one spawn per test file, not per test).

Constants at the top of the file serve as the source of truth for expected
counts and names. Comments document the breakdown so reviewers can verify
without running the server.

### `tests/integration.test.ts`

Gated `describe` block. Uses the same `createTestClient` factory but with
real env vars from the shell environment. Tests make actual MCP tool calls
that hit InfluxDB.

The `execute_query` test is defensive: it first checks if any databases
exist, and skips gracefully if not (rather than failing on an empty instance).

## vitest Configuration

```typescript
// vitest.config.ts
{
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  }
}
```

- **15s timeouts**: Generous for slow CI machines where child process spawn
  + initialize handshake can take 2-3 seconds
- **No pool override**: Default vitest forks handle child process spawning
- **No `rootDir` change to tsconfig**: vitest uses Vite's esbuild pipeline
  to compile test files independently from `tsc`. The production tsconfig
  keeps `rootDir: "./src"` which would reject files outside `src/`.

## Adding a New Test Category

To add a new test file (e.g., `tests/write.test.ts`):

1. Create the file with vitest imports
2. Use `createTestClient()` in `beforeAll`
3. Call `close()` in `afterAll`
4. Each test file spawns its own server process — they run in parallel safely

For integration tests that need InfluxDB, use the same
`describe.skipIf(!process.env.INFLUX_TEST_ENABLED)` gate pattern.

## Local Docker Infrastructure

`docker-compose.test.yml` starts InfluxDB 3 Core with:
- `--object-store memory` — ephemeral, no volumes
- Docker secrets to inject `tests/fixtures/admin-token.json` as
  `--admin-token-file=/run/secrets/admin-token`
- Healthcheck on `/ping` with `start_period: 10s`

The static token `apiv3_test` in the fixture file is only for ephemeral
test containers. The `env.test.example` file is pre-filled to match.

## CI Workflow

The CI workflow at `.github/workflows/ci.yml` has two jobs:

### `test-protocol` (always runs, no InfluxDB)

Runs `npm ci`, `npm run build`, `npm test`. Gates every PR and push to main.
The protocol tests catch dependency breakage within seconds.

### `test-integration-core` (InfluxDB 3 Core)

Uses `docker run` (not `services:`) because Core requires
`--admin-token-file` for token bootstrapping, and the `services:` block
cannot pass container CMD arguments.

The job:
1. Checks out the repo (which includes `tests/fixtures/admin-token.json`)
2. Bind-mounts the token file into the container at `/run/secrets/admin-token`
3. Polls `/ping` until Core is ready (up to 30 seconds)
4. Runs `npm run test:integration` with the static test token
5. Stops the container in an `if: always()` cleanup step

### Future: Enterprise

A third job for Enterprise will be gated on
`github.repository_owner == 'influxdata'` and require the Enterprise Docker
image plus a license key stored in `secrets.INFLUXDB_ENTERPRISE_LICENSE`.
