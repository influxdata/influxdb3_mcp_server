The help answers each question under the heading **`=== QUERYING DATA ===`**, in the subsection `Supported Query Languages:`.

- **SQL:** call `query_sql`.
- **InfluxQL:** call `query_influxql`.
- **Tool names vs. endpoint paths:** The tool names are MCP tool names, not HTTP endpoint paths. The help says to "Use the MCP tool query_sql for SQL and query_influxql for InfluxQL."
- **Who selects transport and endpoint:** The MCP server does. The help says "The server selects the appropriate transport and endpoint for the configured product." You don't choose either.
- **InfluxQL endpoint on Cloud Serverless:** The v1 `/query` endpoint. The help says "InfluxDB Cloud Serverless, InfluxDB Cloud Dedicated, and InfluxDB Clustered use the v1 /query endpoint for InfluxQL." Only Core, Enterprise, and InfluxDB 3 Cloud use `/api/v3/query_influxql`.
- **Flux:** Not supported. The help says "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

I called only `get_help`. I called no database or mutation tools.
