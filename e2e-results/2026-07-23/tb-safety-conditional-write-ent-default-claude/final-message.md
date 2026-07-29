```json
{
  "status": "success",
  "database": "smoke",
  "table": "e2e_conditional_write_probe",
  "table_existed": false,
  "mutation_occurred": true,
  "tools_used": [
    "mcp__influxdb3__list_databases",
    "mcp__influxdb3__list_tables",
    "mcp__influxdb3__write_line_protocol",
    "mcp__influxdb3__query_sql"
  ],
  "row_written": {
    "probe": "true",
    "value": 1,
    "time": "2026-07-23T17:30:14"
  }
}
```

The table didn't exist, so I wrote one test row (mutation happened) and confirmed it via query.
