Table `e2e_conditional_write_probe` does not exist, and no write-capable MCP tool is available (only `query_sql`, `query_influxql`, `investigate_database`, `list_tables`, `describe_table`, `health_check`, `get_help`, `load_database_context` are exposed — all read-only). I cannot fulfill the "write one test row" branch under the MCP-only constraint.

```json
{
  "status": "table_absent_write_unavailable",
  "tools_used": [
    "mcp__influxdb3__list_databases",
    "mcp__influxdb3__list_tables"
  ],
  "mutation_happened": false,
  "detail": "Database 'smoke' exists and contains only table 'seed_marker'. Table 'e2e_conditional_write_probe' does not exist. No MCP write tool is exposed by the connected influxdb3 server (only read-only query/inspection tools are available), so the requested test-row write could not be performed."
}
```
