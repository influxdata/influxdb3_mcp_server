The help section that answers this is headed exactly **`=== QUERYING DATA ===`**.

- **SQL:** call the MCP tool `query_sql`.
- **InfluxQL:** call the MCP tool `query_influxql`.
- **Tool names are not endpoint paths.** They name MCP tools. The help lists the HTTP endpoints separately.
- **The MCP server picks the transport and endpoint.** The help says: "The server selects the appropriate transport and endpoint for the configured product." You only choose which tool to call.
- **InfluxQL endpoint for Cloud Dedicated:** the v1 `/query` endpoint. The help says: "InfluxDB Cloud Serverless, InfluxDB Cloud Dedicated, and InfluxDB Clustered use the v1 /query endpoint for InfluxQL." The `/api/v3/query_influxql` endpoint is listed only for Core, Enterprise, and InfluxDB 3 Cloud.
- **Flux is not supported.** The help says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

I called only `get_help`. I did not call any database or mutation tools.
