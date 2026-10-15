Exact help heading: `=== QUERYING DATA ===`

- SQL: call `query_sql`.
- InfluxQL: call `query_influxql`.
- These tool names are MCP operations, not HTTP endpoint paths.
- The MCP server selects the transport and endpoint appropriate for the configured product.
- For InfluxDB Cloud Serverless, InfluxQL uses the v1-compatible `/query` HTTP endpoint.
- Flux is not supported.
