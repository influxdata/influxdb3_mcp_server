Result rows (JSON), 13 rows from `host_system.metrics`:

```json
[
  {"time":"2026-07-30T04:26:03","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-30T04:26:03","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"2026-07-23T17:27:45","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-23T17:27:45","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"2026-07-23T17:25:38","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"2026-07-23T17:25:38","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-23T17:23:48","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-23T17:23:48","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"2026-07-23T17:19:48","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"2026-07-23T17:19:48","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-23T17:15:26","host":"e2e-host-2","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1},
  {"time":"2026-07-23T17:15:26","host":"e2e-host-1","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"time":"1970-01-01T00:00:01","host":"sA","cpu::usage_idle":32.7,"cpu::usage_sys":12.1,"cpu::usage_user":55.2}
]
```

**Wildcard recovery:** `describe_table` on `host_system.metrics` reported columns without tag/field role metadata (category "unknown"), so I couldn't rely on schema introspection alone to resolve `cpu::usage*`. I resolved the wildcard by listing all columns and pattern-matching the prefix `cpu::usage`, which found 4 matches: `usage_idle`, `usage_sys`, `usage_system`, `usage_user`. These were expanded into explicit quoted column names in the SQL query (required — quoted `*` isn't a valid wildcard in SQL identifiers here).

Note: `cpu::usage_sys` is null for all rows except the `sA` host — that host uses `usage_sys` while the `e2e-host-*` hosts use `usage_system` instead, so no single row populates all four columns at once.
