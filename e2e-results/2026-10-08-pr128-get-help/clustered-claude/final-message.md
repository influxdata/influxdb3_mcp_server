Help heading: **`=== QUERYING DATA ===`**

- **SQL:** call `query_sql`. In this client its full name is `mcp__influxdb3__query_sql`.
- **InfluxQL:** call `query_influxql`. In this client its full name is `mcp__influxdb3__query_influxql`.
- **Are the names endpoint paths?** No. They are MCP tool names. The help never presents them as URLs.
- **Who picks the transport and endpoint:** the MCP server does. The help says: "The server selects the appropriate transport and endpoint for the configured product." You do not choose it.
- **InfluxQL endpoint for Clustered:** the v1 `/query` endpoint. The help puts Clustered with Cloud Serverless and Cloud Dedicated here. The `/api/v3/query_influxql` endpoint is listed only for Core, Enterprise and InfluxDB 3 Cloud.
- **Flux:** not supported. The help says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

I called only `get_help`. I called no database or mutation tools.

One gap: the help lists a SQL endpoint for no product. It also doesn't say whether the CAST rule for aggregations applies to Clustered. That rule is listed only for Cloud Dedicated and Cloud Serverless.
