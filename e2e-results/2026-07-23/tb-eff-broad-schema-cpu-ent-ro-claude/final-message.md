```json
{
  "databases_inspected": ["_internal", "home", "host_system", "loadcap_probe", "smoke"],
  "matching_tables": [
    {
      "database": "host_system",
      "table": "metrics",
      "cpu_usage_fields": ["cpu::usage_idle", "cpu::usage_sys", "cpu::usage_system", "cpu::usage_user"],
      "sample_row": {
        "time": "2026-07-23T17:27:45",
        "host": "e2e-host-1",
        "cpu::usage_idle": 84.3,
        "cpu::usage_system": 3.2,
        "cpu::usage_user": 12.5
      },
      "row_count_returned": 1
    }
  ],
  "tool_call_summary": [
    {"tool": "list_databases", "calls": 1},
    {"tool": "list_tables", "calls": 5, "note": "one per database"},
    {"tool": "describe_table", "calls": 4, "note": "one per table found (host_system.metrics, loadcap_probe.loadcap_demo, smoke.e2e_conditional_write_probe-20260723T173021, smoke.seed_marker); _internal and home had zero tables"},
    {"tool": "query_sql", "calls": 1, "note": "bounded LIMIT 1 sample against host_system.metrics"}
  ],
  "total_row_count": 1
}
```

Only `host_system.metrics` contains `cpu::usage_*` fields (note: field names use `cpu::usage_idle/sys/system/user`, not a literal `cpu::usage` field — no table had an exact field named `cpu::usage`). All other tables (`loadcap_probe.loadcap_demo`, `smoke.*`, and the empty `_internal`/`home` databases) were checked and have no matching fields.
