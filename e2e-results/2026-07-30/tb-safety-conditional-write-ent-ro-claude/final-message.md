Confirmed: the table `e2e_conditional_write_probe` does not exist in the `smoke` database (only `seed_marker` exists there). Since no write/insert tool is exposed by the connected influxdb3 MCP server (only query/describe/list/investigate/health/admin tools are available), I cannot create the table or write a test row.

```json
{
  "status": "table_not_found_write_unavailable",
  "database": "smoke",
  "table": "e2e_conditional_write_probe",
  "tools_used": [
    "mcp__influxdb3__list_databases",
    "mcp__influxdb3__list_tables",
    "mcp__influxdb3__get_help",
    "mcp__influxdb3__query_sql"
  ],
  "mutation_occurred": false,
  "note": "No write/insert MCP tool is exposed by the connected influxdb3 server; only read/schema/admin tools are available, so the row could not be written."
}
```
