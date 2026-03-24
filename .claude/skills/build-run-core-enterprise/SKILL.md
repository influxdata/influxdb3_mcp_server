---
name: Build & Run (Core/Enterprise)
description: >-
  This skill should be used when the user asks to "build the MCP server",
  "run the server", "set up for InfluxDB Core", "set up for InfluxDB Enterprise",
  "configure the server", "start the MCP server", "run with Docker",
  "test the MCP server connection", "use the MCP inspector",
  "set up .env", "what npm commands are available",
  or needs to build, configure, run, or troubleshoot this MCP server against
  InfluxDB 3 Core or InfluxDB 3 Enterprise.
version: 0.1.0
---

# Build & Run: InfluxDB 3 Core / Enterprise

Workflow for building, configuring, and running the InfluxDB MCP server against
InfluxDB 3 Core or Enterprise instances.

## Prerequisites

- Node.js v18+ and npm v9+
- A running InfluxDB 3 Core or Enterprise instance (default port: `8181`).
  When running both Core and Enterprise on the same host for testing, each
  needs a distinct port (e.g., Core on `8181`, Enterprise on `8281`).
- An InfluxDB auth token (operator, admin, or resource token)

## Environment Setup

Create a `.env` file in the project root (or set env vars directly). Three
variables are required:

```env
INFLUX_DB_INSTANCE_URL=http://localhost:8181/
INFLUX_DB_TOKEN=<your_token>
INFLUX_DB_PRODUCT_TYPE=core
```

Set `INFLUX_DB_PRODUCT_TYPE` to `core` or `enterprise`. The server behavior is
identical for both; the type controls which tools are advertised and how
config validation works.

Copy `env.example` as a starting point: `cp env.example .env`

### Token types (Core/Enterprise)

| Token Type | Purpose | How to obtain |
|---|---|---|
| Operator | Full admin, bootstraps the instance | Printed on first `influxdb3 serve` start |
| Admin | Full admin except managing other admins | Created via `create_admin_token` tool |
| Resource | Scoped read/write on specific databases | Created via `create_resource_token` tool |

Use the operator token during initial setup. Create scoped resource tokens for
applications.

## Build & Run

```bash
npm install        # install dependencies
npm run build      # compile TypeScript → build/
npm start          # run the server (requires build/)
npm run dev        # build + run in one step
```

The server communicates over stdio (stdin/stdout). All diagnostic output goes
to stderr. Do not use `console.log` — it would corrupt the MCP transport.

### Verify the server starts

```bash
npm run dev 2>&1 | head -5
```

Look for: `[MCP] Server initialized with N tools, N resources, N prompts`

## Docker Workflow

Build and run via Docker when isolating the server from the host environment
or deploying remotely.

```bash
npm run docker:build    # build Docker image
npm run docker:up       # start (reads .env file)
npm run docker:down     # stop
npm run docker:logs     # tail logs
```

When InfluxDB runs on the host machine, use `host.docker.internal` as the
hostname in `.env`:

```env
INFLUX_DB_INSTANCE_URL=http://host.docker.internal:8181/
INFLUX_DB_TOKEN=<your_token>
INFLUX_DB_PRODUCT_TYPE=enterprise
```

For MCP client configuration examples (local, Docker, npx), see
`.claude/skills/build-run-core-enterprise/references/mcp-client-configs.md`.

## Testing with the MCP Inspector

The MCP Inspector provides an interactive UI for testing tool calls:

```bash
npm run "MCP inspector"   # quotes required (space in script name)
```

This launches the inspector connected to the built server. Use it to:
- Call `health_check` to verify connectivity
- Call `list_databases` to confirm data access
- Test `execute_query` with a simple SQL query

## Available Tools (Core/Enterprise)

All tools available for Core/Enterprise instances:

| Tool | Description |
|---|---|
| `health_check` | Verify connection and health status |
| `list_databases` | List all databases |
| `create_database` | Create a new database |
| `delete_database` | Delete a database |
| `execute_query` | Run SQL queries |
| `get_measurements` | List tables in a database |
| `get_measurement_schema` | Show columns/types for a table |
| `write_line_protocol` | Write data via line protocol |
| `create_admin_token` | Create named admin token |
| `list_admin_tokens` | List admin tokens |
| `create_resource_token` | Create scoped resource token |
| `list_resource_tokens` | List resource tokens |
| `delete_token` | Delete a token by name |
| `regenerate_operator_token` | Regenerate operator token (destructive) |
| `get_help` | Built-in help and troubleshooting |
| `load_database_context` | Load custom context from `context/` |

Tools like `update_database` and `cloud_*` token tools are **not** available
for Core/Enterprise.

## Troubleshooting

### "Configuration validation failed"

Missing or invalid env vars. Verify `.env` has all three required variables
and `INFLUX_DB_PRODUCT_TYPE` is exactly `core` or `enterprise`.

### Health check fails but server starts

The server can start without a reachable InfluxDB instance. Check:
1. InfluxDB is running: `curl http://localhost:8181/ping`
2. Token is valid (operator or admin token for full access)
3. URL has trailing slash if using the default config

### "No data host configured"

`INFLUX_DB_INSTANCE_URL` is missing or empty. For Core/Enterprise, this must
be the full URL including protocol and port.

### Port confusion

InfluxDB 3 Core/Enterprise defaults to port `8181`. Some example files in this
repo reference port `8086` (the InfluxDB 2.x default). Always confirm which
port the target instance listens on. When running both Core and Enterprise on
the same host, each must use a different port — update `INFLUX_DB_INSTANCE_URL`
accordingly for each server instance.

## Additional Resources

### Reference Files

- **`references/mcp-client-configs.md`** — MCP client JSON configs for
  Claude Desktop, Cursor, and other MCP clients (local, Docker, npx variants)
