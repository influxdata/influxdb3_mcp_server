Exact help heading: `=== QUERYING DATA ===`

- SQL: call `query_sql`.
- InfluxQL: call `query_influxql`.
- These tool names are not HTTP endpoint paths; they are MCP tool names.
- The MCP server selects the appropriate transport and endpoint for the configured product.
- For InfluxDB Clustered, InfluxQL uses the v1 `/query` HTTP endpoint.
- Flux is not supported.