```json
{
  "databases_inspected": ["_internal", "home", "host_system", "loadcap_probe", "smoke"],
  "matching_tables": [
    {
      "database": "host_system",
      "table": "metrics",
      "matching_fields": ["cpu::usage_idle", "cpu::usage_sys", "cpu::usage_system", "cpu::usage_user"],
      "sample_row": {
        "time": "2026-07-30T04:26:03",
        "host": "e2e-host-1",
        "cpu::usage_idle": 84.3,
        "cpu::usage_system": 3.2,
        "cpu::usage_user": 12.5
      },
      "row_count_returned": 1
    }
  ],
  "tool_call_summary": [
    { "tool": "list_databases", "calls": 1 },
    { "tool": "get_measurements", "calls": 5, "note": "one per database" },
    { "tool": "describe_table", "calls": 4, "note": "on non-empty tables: host_system.metrics, loadcap_probe.loadcap_demo, smoke.e2e_conditional_write_probe-20260730T042925, smoke.seed_marker" },
    { "tool": "query_sql", "calls": 1, "note": "bounded LIMIT 1 sample on host_system.metrics" }
  ],
  "notes": [
    "_internal and home databases returned 0 measurements — nothing to inspect.",
    "loadcap_probe.loadcap_demo, smoke.e2e_conditional_write_probe-*, and smoke.seed_marker had no cpu::usage fields.",
    "Only host_system.metrics contains cpu::usage-prefixed fields."
  ]
}
```
