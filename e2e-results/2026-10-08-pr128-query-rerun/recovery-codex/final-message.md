Help heading: `INFLUXDB 3 MCP SERVER HELP`

Selected MCP tool: `query_influxql`, because the request explicitly required InfluxQL and regex field selection. Flux is **not supported**.

The initial quoted wildcard query returned zero rows. Schema inspection found three matching CPU columns, so I recovered with:

```sql
SELECT /^cpu::usage.*/ FROM metrics LIMIT 2
```

```json
{
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
    "request_id": "4401e9dd-fa93-4a6f-ae90-bb8fff8b2173",
    "query_id": "317b5b0e-8472-4cfd-827f-87709e413d0f",
    "query_id_source": "system.queries.id",
    "phase": "success",
    "query_type": "influxql",
    "success": true,
    "duration_ms": 22,
    "row_count": 2,
    "truncated": false,
    "running": false,
    "cancelled": false,
    "plan_duration": "PT0.013213917S",
    "permit_duration": "PT0.000021085S",
    "execute_duration": "PT0.000350441S",
    "end2end_duration": "PT0.013645405S",
    "compute_duration": "PT0.000000007S",
    "max_memory": 0
  },
  "warnings": [
    {
      "code": "missing_time_predicate",
      "message": "Query has no obvious time predicate."
    }
  ]
}
```
