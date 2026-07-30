## Result

**Wildcard recovery:** `metrics` in `host_system` has no native `cpu::usage*` selector support in SQL (quoted identifiers must be exact column names), so per the tool's recovery path I ran `describe_table` first. It expanded the wildcard to 4 matching fields out of 10 total columns: `cpu::usage_idle`, `cpu::usage_sys`, `cpu::usage_system`, `cpu::usage_user`. I then re-ran a single bounded `query_sql` selecting those explicitly (plus `time`/`host` for context), ordered by time descending, capped at 1000 rows.

Note: `cpu::usage_sys` and `cpu::usage_system` are near-duplicate field names from what look like different collector runs — most rows populate only `usage_system`, one legacy row (`host: sA`, epoch time) populates only `usage_sys`. Fields absent for a given row are omitted (null) in the JSON below.

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

13 rows returned (no LIMIT truncation, hard cap 5000 not hit). Two hosts (`e2e-host-1`, `e2e-host-2`) plus one legacy record (`sA`, epoch timestamp — likely a test/seed row given the 1970 time).
