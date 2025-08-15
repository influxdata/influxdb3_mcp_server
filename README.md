# InfluxDB MCP Server
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/influxdata/influxdb3_mcp_server)](https://archestra.ai/mcp-catalog/influxdata__influxdb3_mcp_server)

Model Context Protocol (MCP) server for InfluxDB 3 integration. Provides tools, resources, and prompts for interacting with InfluxDB v3 (Core/Enterprise/Cloud Dedicated) via MCP clients.

---

## Prerequisites

- **InfluxDB 3 Instance**: URL and token (Core/Enterprise) or Cluster ID and tokens (Cloud Dedicated)
- **Node.js**: v18 or newer (for npm/npx usage)
- **npm**: v9 or newer (for npm/npx usage)
- **Docker**: (for Docker-based setup)

---

## Available Tools

| Tool Name                     | Description                                                    | Availability         |
| ----------------------------- | -------------------------------------------------------------- | -------------------- |
| `get_help`                    | Get help and troubleshooting guidance for InfluxDB operations  | All versions         |
| `write_line_protocol`         | Write data using InfluxDB line protocol                        | All versions         |
| `create_database`             | Create a new database (with Cloud Dedicated config options)    | All versions         |
| `update_database`             | Update database configuration (maxTables, retention, etc.)     | Cloud Dedicated only |
| `delete_database`             | Delete a database by name (irreversible)                       | All versions         |
| `execute_query`               | Run a SQL query against a database (supports multiple formats) | All versions         |
| `get_measurements`            | List all measurements (tables) in a database                   | All versions         |
| `get_measurement_schema`      | Get schema (columns/types) for a measurement/table             | All versions         |
| `create_admin_token`          | Create a new admin token (full permissions)                    | Core/Enterprise only |
| `list_admin_tokens`           | List all admin tokens (with optional filtering)                | Core/Enterprise only |
| `create_resource_token`       | Create a resource token for specific DBs and permissions       | Core/Enterprise only |
| `list_resource_tokens`        | List all resource tokens (with filtering and ordering)         | Core/Enterprise only |
| `delete_token`                | Delete a token by name                                         | Core/Enterprise only |
| `regenerate_operator_token`   | Regenerate the operator token (dangerous/irreversible)         | Core/Enterprise only |
| `cloud_list_database_tokens`  | List all database tokens for Cloud-Dedicated cluster           | Cloud Dedicated only |
| `cloud_get_database_token`    | Get details of a specific database token by ID                 | Cloud Dedicated only |
| `cloud_create_database_token` | Create a new database token for Cloud-Dedicated cluster        | Cloud Dedicated only |
| `cloud_update_database_token` | Update an existing database token                              | Cloud Dedicated only |
| `cloud_delete_database_token` | Delete a database token from Cloud-Dedicated cluster           | Cloud Dedicated only |
| `list_databases`              | List all available databases in the instance                   | All versions         |
| `health_check`                | Check InfluxDB connection and health status                    | All versions         |

---

## Available Resources

| Resource Name      | Description                                |
| ------------------ | ------------------------------------------ |
| `influx-config`    | Read-only access to InfluxDB configuration |
| `influx-status`    | Real-time connection and health status     |
| `influx-databases` | List of all databases in the instance      |

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

See `env.cloud-dedicated.example` for detailed configuration options and comments.

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
         "args": ["-y", "@modelcontextprotocol/server-influxdb"],
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
- See the `example-*.mcp.json` files for ready-to-use configuration templates:
  - `example-local.mcp.json` - Local development setup
  - `example-npx.mcp.json` - NPX-based setup
  - `example-docker.mcp.json` - Docker-based setup
  - `example-cloud-dedicated.mcp.json` - Cloud Dedicated with all variables
- See the `env.example` and `env.cloud-dedicated.example` files for environment variable templates.

---

## Support & Troubleshooting

- Use the `get_help` tool for built-in help and troubleshooting.
- For connection issues, check your environment variables and InfluxDB instance status.
- For advanced configuration, see the comments in the example `.env` and MCP config files.

---

## License

[MIT](LICENSE)
