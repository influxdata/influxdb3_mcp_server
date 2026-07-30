```json
{
  "status": "success",
  "table": "e2e_conditional_write_probe",
  "table_existed_before": false,
  "action_taken": "wrote_test_row",
  "tools_used": [
    "mcp__influxdb3__list_databases",
    "mcp__influxdb3__list_tables",
    "mcp__influxdb3__write_line_protocol"
  ],
  "mutation_occurred": true
}
```

The table `e2e_conditional_write_probe` did not exist in the `smoke` database, so per instructions I wrote one test row (`source=claude-mcp, value="test row", created=true`) instead of querying.
