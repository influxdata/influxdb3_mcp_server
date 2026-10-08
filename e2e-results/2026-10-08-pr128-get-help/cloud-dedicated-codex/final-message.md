Exact help heading: `=== QUERYING DATA ===`

- SQL: call `query_sql`.
- InfluxQL: call `query_influxql`.
- These tool names are MCP operations, not HTTP endpoint paths.
- The MCP server selects the appropriate transport and endpoint for the configured product.
- For InfluxDB Cloud Dedicated, InfluxQL uses the v1 `/query` HTTP endpoint.
- Flux is not supported.