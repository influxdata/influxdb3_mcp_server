Databases: `_internal`, `home`, `host_system`, `loadcap_probe`, `smoke`. Target `host_system` found, with a single table `metrics`.

**CPU usage from `host_system.metrics`** (JSON, last 11 rows, no error):

```json
{
  "db": "host_system",
  "row_count": 11,
  "query_id_source": "system.queries.id",
  "error_code": null,
  "rows": [
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

Note: `cpu::usage_sys` is null/absent for hosts e2e-host-1/2 (they use `cpu::usage_system` instead); only the `sA` host row populates `cpu::usage_sys`.
