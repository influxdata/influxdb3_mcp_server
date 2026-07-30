Done. Databases: `_internal`, `host_system`, `smoke`. Used `host_system` (non-internal), table `metrics`.

```json
{
  "database": "host_system",
  "table": "metrics",
  "query": "SELECT * FROM metrics ORDER BY time DESC LIMIT 5",
  "row_count": 2,
  "rows": [
    {"cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1, "host": "e2e-host-2", "time": "2026-07-30T04:26:05"},
    {"cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5, "host": "e2e-host-1", "time": "2026-07-30T04:26:05"}
  ],
  "duration_ms": 36
}
```
