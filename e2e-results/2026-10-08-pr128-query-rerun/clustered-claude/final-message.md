The answer comes from help section **`=== QUERYING DATA ===`**.

- **SQL:** call `query_sql`.
- **InfluxQL:** call `query_influxql`.
- **Tool names are not endpoint paths.** They are MCP tool names. They do not map one-to-one to HTTP routes.
- **The MCP server selects transport and endpoint.** You do not pick them. Help says: "The server selects the appropriate transport and endpoint for the configured product."
- **InfluxQL endpoint on Clustered:** v1 `/query`. Help says: "InfluxDB Cloud Serverless, InfluxDB Cloud Dedicated, and InfluxDB Clustered use the v1 /query endpoint for InfluxQL." `/api/v3/query_influxql` is listed only for Core, Enterprise, and InfluxDB 3 Cloud.
- **Flux is not supported.** Help says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

Only `get_help` was called. No database or mutation tools were called.

`★ Insight ─────────────────────────────────────`
- On Clustered, `query_influxql` sends queries to `/query`, not `/api/v3/query_influxql`. Keep that in mind if you check server logs or proxy rules.
- Help lists the `query_sql` description's JSON-only output limit for Cloud Dedicated, Serverless, and Clustered. Do not request csv or parquet output.
`─────────────────────────────────────────────────`
