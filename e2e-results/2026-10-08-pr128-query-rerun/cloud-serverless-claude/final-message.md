Help heading: `=== QUERYING DATA ===`.

- **SQL:** call `query_sql` (in this session, `mcp__influxdb3__query_sql`).
- **InfluxQL:** call `query_influxql` (in this session, `mcp__influxdb3__query_influxql`).
- **Endpoint paths:** No. These are MCP tool names, not HTTP endpoint paths.
- **Who picks transport and endpoint:** The MCP server does. Help says: "The server selects the appropriate transport and endpoint for the configured product." You do not pick it.
- **InfluxQL endpoint on Cloud Serverless:** the v1 `/query` endpoint. Help says: "InfluxDB Cloud Serverless, InfluxDB Cloud Dedicated, and InfluxDB Clustered use the v1 /query endpoint for InfluxQL." Help lists `/api/v3/query_influxql` only for Core, Enterprise, and InfluxDB 3 Cloud.
- **Flux:** Not supported. Help says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

I called only `get_help`. I called no database tools and no mutation tools.
