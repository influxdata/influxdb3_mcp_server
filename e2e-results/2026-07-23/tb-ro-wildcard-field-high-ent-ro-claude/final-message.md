Query complete. Here are the results (11 rows, JSON):

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

**Wildcard recovery:** `host_system` is a database (via `list_databases`), containing one table, `metrics` (via `list_tables`). SQL doesn't support `*` inside quoted identifiers, so `"cpu::usage*"` isn't a literal usable selector — I ran `describe_table` on `metrics` to get the real schema and expanded the wildcard by hand to every field matching the `cpu::usage` prefix:

- `cpu::usage_idle`
- `cpu::usage_sys`
- `cpu::usage_system`
- `cpu::usage_user`

Then issued one bounded `query_sql` selecting `time`, `host`, and those four fields explicitly, ordered by time descending. Note most rows only populate `cpu::usage_idle/system/user` (from `e2e-host-1`/`e2e-host-2`); one older row (`host=sA`, epoch time) also has `cpu::usage_sys` — the two `sys`/`system` variants appear to come from different data sources, which is why they don't co-occur per row.
