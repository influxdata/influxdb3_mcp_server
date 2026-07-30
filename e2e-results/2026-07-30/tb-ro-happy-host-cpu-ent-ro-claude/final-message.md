```json
{
  "db": "host_system",
  "row_count": 13,
  "query_id_source": "system.queries.id",
  "error_code": null,
  "cpu_metrics": [
    {"time": "2026-07-30T04:26:03", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-30T04:26:03", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "2026-07-23T17:27:45", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-23T17:27:45", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "2026-07-23T17:25:38", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "2026-07-23T17:25:38", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-23T17:23:48", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-23T17:23:48", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "2026-07-23T17:19:48", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "2026-07-23T17:19:48", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-23T17:15:26", "host": "e2e-host-2", "cpu::usage_idle": 45.2, "cpu::usage_system": 9.7, "cpu::usage_user": 45.1},
    {"time": "2026-07-23T17:15:26", "host": "e2e-host-1", "cpu::usage_idle": 84.3, "cpu::usage_system": 3.2, "cpu::usage_user": 12.5},
    {"time": "1970-01-01T00:00:01", "host": "sA", "cpu::usage_idle": 32.7, "cpu::usage_sys": 12.1, "cpu::usage_user": 55.2}
  ]
}
```

Databases found: `_internal`, `home`, `host_system`, `loadcap_probe`, `smoke`. `host_system` was the target for CPU metrics (single table: `metrics`). No errors — query succeeded, `error code: null`.
