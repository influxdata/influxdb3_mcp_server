The answers come from the help section **`=== QUERYING DATA ===`**.

- **SQL:** call `query_sql`.
- **InfluxQL:** call `query_influxql`.
- **Tool names and endpoint paths:** The names are MCP tool names, not HTTP endpoint paths. The help calls them "the MCP tool query_sql … and query_influxql."
- **Who picks the transport and endpoint:** The MCP server does, not you. The help says: "The server selects the appropriate transport and endpoint for the configured product."
- **InfluxQL endpoint on Cloud Dedicated:** the v1 `/query` endpoint. The help says: "InfluxDB Cloud Serverless, InfluxDB Cloud Dedicated, and InfluxDB Clustered use the v1 /query endpoint for InfluxQL." Core, Enterprise, and InfluxDB 3 Cloud use `/api/v3/query_influxql` instead, but that does not apply to you.
- **Flux:** not supported. The help says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

I called only `get_help`. I made no database, query, or write calls.

`★ Insight ─────────────────────────────────────`
- The tool name says which query language you use. The configured product decides which HTTP endpoint the request goes to. The same `query_influxql` call goes to `/query` on Dedicated and to `/api/v3/query_influxql` on Core or Enterprise.
- Help also has a Cloud Dedicated rule for SQL. Wrap aggregates in `CAST(... AS DOUBLE)`, or results may come back empty.
`─────────────────────────────────────────────────`
