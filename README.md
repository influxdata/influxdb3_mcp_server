# InfluxDB MCP Server

[![CI](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/ci.yml/badge.svg)](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/ci.yml)

<!-- [![Unit Tests](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/unit.yml/badge.svg)](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/unit.yml) -->
<!-- [![Lint](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/lint.yml/badge.svg)](https://github.com/influxdata/influxdb3_mcp_server/actions/workflows/lint.yml) -->

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/influxdata/influxdb3_mcp_server)](https://archestra.ai/mcp-catalog/influxdata__influxdb3_mcp_server)

Model Context Protocol (MCP) server for InfluxDB 3 integration. Provides tools, resources, and prompts for interacting with InfluxDB v3 (Core/Enterprise/Cloud Dedicated/Clustered/Cloud Serverless) via MCP clients.

---

## Prerequisites

- **InfluxDB 3 Instance**: URL and token (Core/Enterprise/Cloud Serverless) or Cluster ID and tokens (Cloud Dedicated/Clustered)
- **Node.js**: v20.11 or newer (for npm/npx usage)
- **npm**: v9 or newer (for npm/npx usage)
- **Docker**: (for Docker-based setup)

---

## Read-only Agent Workflows

Set `INFLUX_MCP_TOOL_PROFILE=readonly` when you want an MCP client to explore
and query InfluxDB 3 data without exposing write, admin, token-management, or
host-level tools. In Enterprise deployments that use preview user auth, the
same read-only flow works when the configured bearer credential is a JWT instead
of an `apiv3_` token.

### Analyst explores an unfamiliar database

An analyst can connect an MCP client such as Claude Desktop, Cursor, Codex, or
another agent harness and ask a question like:

```text
Which sensors had the highest average temperature in the last 24 hours?
```

With the read-only profile, the agent can:

1. Call `list_databases` to see accessible databases.
2. Call `list_tables` and `describe_table` to discover measurements and
   columns.
3. Treat uncertain tag and field categories as `unknown`.
4. Build a bounded SQL query with `db`, `q`, and optional `params`.
5. Call `query_sql` with structured JSON output.
6. Return the result, row count, truncation status, warnings, and correlation
   metadata.

The user gets a grounded answer and a reusable query while the agent explores
and queries data without access to mutation or administration tools.

### Operator investigates an InfluxQL dashboard query

An operator can troubleshoot an existing InfluxQL dashboard panel and ask:

```text
Why did this panel stop showing data after the deploy?
```

With the read-only profile, the agent can:

1. Keep the user's query in InfluxQL and call `query_influxql`.
2. Use `SHOW` queries and schema discovery to verify the measurement and
   referenced columns.
3. Sample recent rows with bounded reads to distinguish missing data from a
   broken query.
4. Reject unsafe follow-up attempts, such as `SELECT INTO` or destructive
   statements.
5. Return `request_id`, `query_id`, and `query_id_source` so the operator can
   correlate the MCP result with `system.queries.id` when query history is
   available.
6. Emit structured logs to stderr for stdio transports so stdout remains
   reserved for MCP protocol messages.

The user gets a practical diagnosis, such as missing data, renamed schema, a
wrong time predicate, or a query failure. The investigation is traceable without
logging full query text by default.

---

## Available Tools

| Tool Name                     | Description                                                                                           | Availability              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| `load_database_context`       | Load optional custom database context and documentation                                               | All versions              |
| `get_help`                    | Get help and troubleshooting guidance for InfluxDB operations                                         | All versions              |
| `write_line_protocol`         | Write data using InfluxDB line protocol                                                               | All versions              |
| `create_database`             | Create a new database (with cloud-specific config options)                                            | All versions              |
| `update_database`             | Update database configuration (retention for all; maxTables/maxColumns for Cloud Dedicated/Clustered) | All versions              |
| `delete_database`             | Delete a database by name (irreversible)                                                              | All versions              |
| `execute_query`               | Run a SQL query against a database (supports multiple formats)                                        | All versions              |
| `query_sql`                   | Run bounded read-only SQL with structured response metadata                                           | All versions              |
| `query_influxql`              | Run bounded read-only InfluxQL with structured response metadata                                      | All versions              |
| `get_measurements`            | List all measurements (tables) in a database                                                          | All versions              |
| `get_measurement_schema`      | Get schema (columns/types) for a measurement/table                                                    | All versions              |
| `list_tables`                 | List tables, also called measurements, in a database                                                  | All versions              |
| `describe_table`              | Describe table schema with conservative column categories                                             | All versions              |
| `investigate_database`        | Run high-level read-only database discovery and sampling                                              | All versions              |
| `create_admin_token`          | Create a new admin token (full permissions)                                                           | Core/Enterprise only      |
| `list_admin_tokens`           | List all admin tokens (with optional filtering)                                                       | Core/Enterprise only      |
| `create_resource_token`       | Create a resource token for specific DBs and permissions                                              | Core/Enterprise only      |
| `list_resource_tokens`        | List all resource tokens (with filtering and ordering)                                                | Core/Enterprise only      |
| `delete_token`                | Delete a token by name                                                                                | Core/Enterprise only      |
| `regenerate_operator_token`   | Regenerate the operator token (dangerous/irreversible)                                                | Core/Enterprise only      |
| `cloud_list_database_tokens`  | List all database tokens for Cloud-Dedicated/Clustered cluster                                        | Cloud Dedicated/Clustered |
| `cloud_get_database_token`    | Get details of a specific database token by ID                                                        | Cloud Dedicated/Clustered |
| `cloud_create_database_token` | Create a new database token for Cloud-Dedicated/Clustered cluster                                     | Cloud Dedicated/Clustered |
| `cloud_update_database_token` | Update an existing database token                                                                     | Cloud Dedicated/Clustered |
| `cloud_delete_database_token` | Delete a database token from Cloud-Dedicated/Clustered cluster                                        | Cloud Dedicated/Clustered |
| `list_databases`              | List all available databases in the instance                                                          | All versions              |
| `health_check`                | Check InfluxDB connection and health status                                                           | All versions              |

---

## Available Resources

| Resource Name      | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `influx-config`    | Read-only access to InfluxDB configuration              |
| `influx-status`    | Real-time connection and health status                  |
| `influx-databases` | List of all databases in the instance                   |
| `context-file`     | Custom user-provided database context and documentation |

---

## Available Prompts

| Prompt Name      | Description                                       |
| ---------------- | ------------------------------------------------- |
| `list-databases` | Generate a prompt to list all available databases |
| `check-health`   | Generate a prompt to check InfluxDB health status |
| `load-context`   | Load custom database context and documentation    |

---

## Setup & Integration Guide

### 1. Environment Variables

#### For Core/Enterprise InfluxDB:

You must provide:

- `INFLUX_DB_INSTANCE_URL` (e.g. `http://localhost:8181/`)
- `INFLUX_DB_TOKEN`
- `INFLUX_DB_PRODUCT_TYPE` (`core` or `enterprise`)

Example `.env`:

```env
INFLUX_DB_INSTANCE_URL=http://localhost:8181/
INFLUX_DB_TOKEN=your_influxdb_token_here
INFLUX_DB_PRODUCT_TYPE=core
```

#### For Cloud Serverless InfluxDB:

You must provide:

- `INFLUX_DB_INSTANCE_URL` (e.g. `https://us-east-1-1.aws.cloud2.influxdata.com`)
- `INFLUX_DB_TOKEN`
- `INFLUX_DB_PRODUCT_TYPE` (`cloud-serverless`)

Example `.env`:

```env
INFLUX_DB_INSTANCE_URL=https://us-east-1-1.aws.cloud2.influxdata.com
INFLUX_DB_TOKEN=your_influxdb_token_here
INFLUX_DB_PRODUCT_TYPE=cloud-serverless
```

#### For Cloud Dedicated InfluxDB:

You must provide `INFLUX_DB_PRODUCT_TYPE=cloud-dedicated` and `INFLUX_DB_CLUSTER_ID`, plus one of these token combinations:

**Option 1: Database Token Only** (Query/Write operations only):

```env
INFLUX_DB_PRODUCT_TYPE=cloud-dedicated
INFLUX_DB_CLUSTER_ID=your_cluster_id_here
INFLUX_DB_TOKEN=your_database_token_here
```

**Option 2: Management Token Only** (Database management only):

```env
INFLUX_DB_PRODUCT_TYPE=cloud-dedicated
INFLUX_DB_CLUSTER_ID=your_cluster_id_here
INFLUX_DB_ACCOUNT_ID=your_account_id_here
INFLUX_DB_MANAGEMENT_TOKEN=your_management_token_here
```

**Option 3: Both Tokens** (Full functionality):

```env
INFLUX_DB_PRODUCT_TYPE=cloud-dedicated
INFLUX_DB_CLUSTER_ID=your_cluster_id_here
INFLUX_DB_ACCOUNT_ID=your_account_id_here
INFLUX_DB_TOKEN=your_database_token_here
INFLUX_DB_MANAGEMENT_TOKEN=your_management_token_here
```

#### For Clustered InfluxDB:

You must provide `INFLUX_DB_PRODUCT_TYPE=clustered` and `INFLUX_DB_INSTANCE_URL`, plus one of these token combinations:

**Option 1: Database Token Only** (Query/Write operations only):

```env
INFLUX_DB_PRODUCT_TYPE=clustered
INFLUX_DB_INSTANCE_URL=https://your_cluster_host.com
INFLUX_DB_TOKEN=your_database_token_here
```

**Option 2: Management Token Only** (Database management only):

```env
INFLUX_DB_PRODUCT_TYPE=clustered
INFLUX_DB_INSTANCE_URL=https://your_cluster_host.com
INFLUX_DB_MANAGEMENT_TOKEN=your_management_token_here
```

**Option 3: Both Tokens** (Full functionality):

```env
INFLUX_DB_PRODUCT_TYPE=clustered
INFLUX_DB_INSTANCE_URL=https://your_cluster_host.com
INFLUX_DB_TOKEN=your_database_token_here
INFLUX_DB_MANAGEMENT_TOKEN=your_management_token_here
```

See corresponding `env.<instancetype>.example` for examples and detailed info.

#### Optional MCP tool profile and telemetry

Use `INFLUX_MCP_TOOL_PROFILE=readonly` to expose only read-only tools. If
unset, the server uses the full operator tool profile.

```env
INFLUX_MCP_TOOL_PROFILE=readonly
```

Tool-call telemetry is enabled by default and writes structured JSON lines to
`stderr`, which keeps `stdout` reserved for MCP stdio protocol messages. To
disable telemetry:

```env
MCP_LOG_TOOL_CALLS=false
```

To write telemetry to a file, configure the file backend:

```env
MCP_LOG_BACKEND=file
MCP_LOG_FILE=/logs/influxdb-mcp.jsonl
```

The telemetry log includes tool name, request ID, query ID, duration, database,
row count, truncation state, success state, and error code. It does not log API
tokens, request headers, tool arguments, or query text. Sample harness profiles
live in `harness-profiles/`; for approval settings and repeatable E2E prompts,
see `AGENT_E2E_TESTS.md`.

---

### 2. Integration with MCP Clients

#### A. Local (npm install & run)

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Build the server:**
   ```bash
   npm run build
   ```
3. **Configure your MCP client** to use the built server. Example (see `example-local.mcp.json`):
   ```json
   {
     "mcpServers": {
       "influxdb": {
         "command": "node",
         "args": ["/path/to/influx-mcp-standalone/build/index.js"],
         "env": {
           "INFLUX_DB_INSTANCE_URL": "http://localhost:8181/",
           "INFLUX_DB_TOKEN": "<YOUR_INFLUXDB_TOKEN>",
           "INFLUX_DB_PRODUCT_TYPE": "core"
         }
       }
     }
   }
   ```

#### B. Local (npx, no install/build required)

1. **Run directly with npx** (after publishing to npm, won't work yet):
   ```json
   {
     "mcpServers": {
       "influxdb": {
         "command": "npx",
         "args": ["-y", "@influxdata/influxdb3-mcp-server"],
         "env": {
           "INFLUX_DB_INSTANCE_URL": "http://localhost:8181/",
           "INFLUX_DB_TOKEN": "<YOUR_INFLUXDB_TOKEN>",
           "INFLUX_DB_PRODUCT_TYPE": "core"
         }
       }
     }
   }
   ```

#### C. Docker

Before running the Docker integration, you must build the Docker image:

```bash
# Option 1: Use docker compose (recommended)
docker compose build
# Option 2: Use npm script
npm run docker:build
```

**a) Docker with remote InfluxDB instance** (see `example-docker.mcp.json`):

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "INFLUX_DB_INSTANCE_URL",
        "-e",
        "INFLUX_DB_TOKEN",
        "-e",
        "INFLUX_DB_PRODUCT_TYPE",
        "mcp/influxdb"
      ],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://remote-influxdb-host:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_INFLUXDB_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "core"
      }
    }
  }
}
```

**b) Docker with InfluxDB running in Docker on the same machine** (see `example-docker.mcp.json`):

Use `host.docker.internal` as the InfluxDB URL so the MCP server container can reach the InfluxDB container:

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--add-host=host.docker.internal:host-gateway",
        "-e",
        "INFLUX_DB_INSTANCE_URL",
        "-e",
        "INFLUX_DB_TOKEN",
        "-e",
        "INFLUX_DB_PRODUCT_TYPE",
        "influxdb-mcp-server"
      ],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://host.docker.internal:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_INFLUXDB_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "enterprise"
      }
    }
  }
}
```

---

## Example Usage

- Use your MCP client to call tools, resources, or prompts as described above.
- **Custom Context**: Edit the provided `context/database-context.md` file or remove it and create your own context file with "context" in the name (`.json`, `.txt`, `.md`) to provide database documentation. Use the `load_database_context` tool or `load-context` prompt to access it.
- See the `example-*.mcp.json` files for ready-to-use configuration templates:
  - `example-local.mcp.json` - Local development setup
  - `example-npx.mcp.json` - NPX-based setup
  - `example-docker.mcp.json` - Docker-based setup
  - `example-cloud-dedicated.mcp.json` - Cloud Dedicated with all variables
  - `example-clustered.mcp.json` - Clustered with all variables
  - `example-cloud-serverless.mcp.json` - Cloud Serverless configuration
- See the `env.example`, `env.cloud-dedicated.example`, `env.clustered.example`, and `env.cloud-serverless.example` files for environment variable templates.
- See `AGENT_E2E_TESTS.md` for MCP harness tips, read-only profile runs, and telemetry correlation checks.

### Database Retention Policy Examples

#### Core/Enterprise - Set 90-day Retention

```typescript
// Set 90-day retention policy on Enterprise instance
await mcp.update_database({
  name: "my_database",
  retentionPeriod: 7776000000000000, // 90 days in nanoseconds
});
```

#### Cloud Dedicated - Update Multiple Settings

```typescript
// Update retention, maxTables, and maxColumnsPerTable
await mcp.update_database({
  name: "my_database",
  retentionPeriod: 7776000000000000, // 90 days
  maxTables: 1000,
  maxColumnsPerTable: 250,
});
```

#### Common Retention Periods

| Duration | Nanoseconds            |
| -------- | ---------------------- |
| 7 days   | 604,800,000,000,000    |
| 30 days  | 2,592,000,000,000,000  |
| 90 days  | 7,776,000,000,000,000  |
| 180 days | 15,552,000,000,000,000 |
| 1 year   | 31,536,000,000,000,000 |

---

## Support & Troubleshooting

- Use the `get_help` tool for built-in help and troubleshooting.
- For connection issues, check your environment variables and InfluxDB instance status.
- For advanced configuration, see the comments in the example `.env` and MCP config files.

---

## License

[MIT](LICENSE)
