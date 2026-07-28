```json
{
  "databases": ["_internal", "host_system", "smoke"],
  "table_queried": {"db": "host_system", "table": "metrics"},
  "query": "SELECT * FROM metrics ORDER BY time DESC LIMIT 5",
  "row_count": 2,
  "rows": [
    {
      "time": "2026-07-23T17:27:46",
      "host": "e2e-host-2",
      "cpu::usage_idle": 45.2,
      "cpu::usage_system": 9.7,
      "cpu::usage_user": 45.1
    },
    {
      "time": "2026-07-23T17:27:46",
      "host": "e2e-host-1",
      "cpu::usage_idle": 84.3,
      "cpu::usage_system": 3.2,
      "cpu::usage_user": 12.5
    }
  ],
  "query_metadata": {
    "duration_ms": 10,
    "query_type": "sql",
    "truncated": false
  }
}
```

Databases: `_internal` (system/internal), `host_system`, `smoke`. Used `host_system` → table `metrics` (non-internal), ran a bounded 5-row query, got 2 rows of CPU usage metrics for two hosts.
