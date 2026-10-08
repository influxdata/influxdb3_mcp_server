```json
{
  "help_heading": "INFLUXDB 3 MCP SERVER HELP",
  "selected_tool": "query_influxql",
  "selection_reason": "The request explicitly required InfluxQL and regex field selection.",
  "flux_supported": false,
  "initial_query": {
    "q": "SELECT \"cpu::usage*\" FROM metrics LIMIT 2",
    "rows": [],
    "metadata": {
      "request_id": "b7da37d8-8916-4cbd-90f8-3dc503ec614f",
      "query_id": "f6a57ce5-d8bc-46c9-be63-b136806b893f",
      "query_id_source": "system.queries.id",
      "phase": "success",
      "query_type": "influxql",
      "success": true,
      "duration_ms": 693,
      "row_count": 0,
      "truncated": false,
      "running": false,
      "cancelled": false,
      "plan_duration": "PT0.217730627S",
      "permit_duration": "PT0.000045914S",
      "execute_duration": "PT0.000289614S",
      "end2end_duration": "PT0.218067696S",
      "compute_duration": "P0D",
      "max_memory": 0
    }
  },
  "schema_matches": [
    "cpu::usage_idle",
    "cpu::usage_system",
    "cpu::usage_user"
  ],
  "recovery_query": {
    "q": "SELECT /cpu::usage.*/ FROM metrics LIMIT 2",
    "rows": [
      {
        "iox::measurement": "metrics",
        "time": "2026-01-01T00:00:00",
        "cpu::usage_idle": 84.3,
        "cpu::usage_system": 3.2,
        "cpu::usage_user": 12.5
      },
      {
        "iox::measurement": "metrics",
        "time": "2026-01-01T00:00:00",
        "cpu::usage_idle": 45.2,
        "cpu::usage_system": 9.7,
        "cpu::usage_user": 45.1
      }
    ],
    "metadata": {
      "request_id": "c49608d5-1d64-4762-9aa4-3698b888a028",
      "query_id": "1230c678-8e20-4504-a502-1dc31f05f09d",
      "query_id_source": "system.queries.id",
      "phase": "success",
      "query_type": "influxql",
      "success": true,
      "duration_ms": 29,
      "row_count": 2,
      "truncated": false,
      "running": false,
      "cancelled": false,
      "plan_duration": "PT0.019135383S",
      "permit_duration": "PT0.000067122S",
      "execute_duration": "PT0.001132996S",
      "end2end_duration": "PT0.020453204S",
      "compute_duration": "PT0.000000007S",
      "max_memory": 0
    }
  }
}
```