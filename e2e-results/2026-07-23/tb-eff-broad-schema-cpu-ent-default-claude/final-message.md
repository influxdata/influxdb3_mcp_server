```json
{
  "databases_inspected": ["_internal", "home", "host_system", "loadcap_probe", "smoke"],
  "matching_tables": [
    {
      "database": "host_system",
      "table": "metrics",
      "cpu_usage_fields": ["cpu::usage_idle", "cpu::usage_sys", "cpu::usage_system", "cpu::usage_user"],
      "sample_row": {
        "cpu::usage_idle": 45.2,
        "cpu::usage_system": 9.7,
        "cpu::usage_user": 45.1,
        "host": "e2e-host-2",
        "time": "2026-07-23T17:27:45"
      }
    }
  ],
  "tool_call_summary": [
    { "tool": "list_databases", "calls": 1 },
    { "tool": "get_measurements", "calls": 5, "note": "one per database" },
    { "tool": "get_measurement_schema", "calls": 4, "note": "one per non-empty measurement found" },
    { "tool": "execute_query", "calls": 1, "note": "bounded LIMIT 1 sample on matching table" }
  ],
  "row_counts": {
    "host_system.metrics": "1 sample row returned (query bounded with LIMIT 1; not a full table count)"
  }
}
```

Summary: Of 5 databases (`_internal`, `home`, `host_system`, `loadcap_probe`, `smoke`), only `_internal` and `home` had no measurements. Of the 4 measurements found across the rest, only `host_system.metrics` contains `cpu::usage*` fields (`usage_idle`, `usage_sys`, `usage_system`, `usage_user`). Note: `cpu::usage_sys` appeared in schema but not in the returned sample row (likely null for that row).
