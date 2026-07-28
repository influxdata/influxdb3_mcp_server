Result rows (JSON):

```json
[
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

**Wildcard recovery:** SQL in this MCP tool doesn't support `*` wildcards directly — quoted identifiers are treated as literal column names, so a literal `"cpu::usage*"` selector would fail. I ran `describe_table` on `metrics` first to list all columns, matched everything starting with `cpu::usage`, and found 4 fields: `cpu::usage_idle`, `cpu::usage_sys`, `cpu::usage_system`, `cpu::usage_user`. I then explicitly selected those 4 in the query.

Note: `cpu::usage_sys` is only populated for host `sA` (an older/differently-instrumented source); the `e2e-host-*` rows use `cpu::usage_system` instead and show `null`/absent for `cpu::usage_sys` — this is real schema variation across hosts, not a query error.
