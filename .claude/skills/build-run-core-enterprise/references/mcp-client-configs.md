# MCP Client Configuration Examples

JSON configs for integrating this server with MCP clients (Claude Desktop,
Cursor, VS Code, etc.). Replace placeholder values with actual credentials.

## Local (built from source)

After `npm install && npm run build`, point the client at the built entry point:

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://localhost:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "core"
      }
    }
  }
}
```

Replace `/absolute/path/to/` with the actual path to this repository.
Set `INFLUX_DB_PRODUCT_TYPE` to `core` or `enterprise`.

## NPX (no local build required)

Runs the published npm package directly. Requires the package to be published
to npm first:

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "npx",
      "args": ["-y", "@influxdata/influxdb3-mcp-server"],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://localhost:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "core"
      }
    }
  }
}
```

## Docker (InfluxDB on same host)

Build the image first: `npm run docker:build`

Use `host.docker.internal` to reach InfluxDB running on the Docker host:

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--add-host=host.docker.internal:host-gateway",
        "-e", "INFLUX_DB_INSTANCE_URL",
        "-e", "INFLUX_DB_TOKEN",
        "-e", "INFLUX_DB_PRODUCT_TYPE",
        "influxdb-mcp-server"
      ],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://host.docker.internal:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "enterprise"
      }
    }
  }
}
```

## Docker (remote InfluxDB)

When InfluxDB is on a separate host, use the remote URL directly (no
`--add-host` needed):

```json
{
  "mcpServers": {
    "influxdb": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "INFLUX_DB_INSTANCE_URL",
        "-e", "INFLUX_DB_TOKEN",
        "-e", "INFLUX_DB_PRODUCT_TYPE",
        "influxdb-mcp-server"
      ],
      "env": {
        "INFLUX_DB_INSTANCE_URL": "http://remote-influxdb-host:8181/",
        "INFLUX_DB_TOKEN": "<YOUR_TOKEN>",
        "INFLUX_DB_PRODUCT_TYPE": "core"
      }
    }
  }
}
```

## Notes

- The `env` block in the MCP client config sets environment variables for the
  server process. These override any `.env` file.
- The example `example-*.mcp.json` files in the repo root contain similar
  configs.
- Port `8181` is the InfluxDB 3 default. Adjust if your instance uses a
  different port.
