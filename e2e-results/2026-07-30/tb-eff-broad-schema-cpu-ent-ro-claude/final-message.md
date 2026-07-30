```json
{
  "databases_inspected": ["_internal", "home", "host_system", "loadcap_probe", "smoke"],
  "matching_tables": [
    {
      "db": "host_system",
      "table": "metrics",
      "cpu_usage_fields": ["cpu::usage_idle", "cpu::usage_sys", "cpu::usage_system", "cpu::usage_user"],
      "sample_row": {
        "cpu::usage_idle": 84.3,
        "cpu::usage_system": 3.2,
        "cpu::usage_user": 12.5,
        "host": "e2e-host-1",
        "time": "2026-07-30T04:26:03"
      }
    }
  ],
  "tool_call_summary": [
    {"tool": "list_databases", "calls": 1},
    {"tool": "list_tables", "calls": 5, "targets": ["_internal", "home", "host_system", "loadcap_probe", "smoke"]},
    {"tool": "describe_table", "calls": 4, "targets": [
      "host_system.metrics",
      "loadcap_probe.loadcap_demo",
      "smoke.e2e_conditional_write_probe-20260730T042925",
      "smoke.seed_marker"
    ]},
    {"tool": "query_sql", "calls": 1, "target": "host_system.metrics", "query": "SELECT * FROM metrics ORDER BY time DESC LIMIT 1"}
  ],
  "row_counts": {
    "host_system.metrics": 1
  },
  "notes": "_internal and home databases contain no tables. loadcap_probe.loadcap_demo and smoke's two tables were inspected but have no cpu::usage fields."
}
```

**Summary:** Across 5 databases, only `host_system.metrics` contains `cpu::usage` fields (idle/sys/system/user). Pulled 1 bounded sample row (LIMIT 1) from it; no other table qualified.
