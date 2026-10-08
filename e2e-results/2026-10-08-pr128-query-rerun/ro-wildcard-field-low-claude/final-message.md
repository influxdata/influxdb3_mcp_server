SQL can't match column names with a wildcard. In SQL, `"cpu::usage*"` is a quoted identifier. The engine reads it as one exact column name, and no column has that name. So I checked the table schema and listed the three matching columns by name. I also added `time` and `host` so each row has context.

```sql
SELECT time, host, "cpu::usage_idle", "cpu::usage_system", "cpu::usage_user"
FROM metrics ORDER BY time DESC LIMIT 100
```

The table has only 2 rows, both at the same timestamp:

| time | host | usage_idle | usage_system | usage_user |
|---|---|---|---|---|
| 2026-01-01T00:00:00 | e2e-host-2 | 45.2 | 9.7 | 45.1 |
| 2026-01-01T00:00:00 | e2e-host-1 | 84.3 | 3.2 | 12.5 |

For each host, idle, system and user add up to 100. That means these three columns cover all the CPU time. e2e-host-2 is much busier, at about 55% busy versus about 16% for e2e-host-1.

If you want real pattern matching on field names, InfluxQL supports it with a regex: `SELECT /^cpu::usage/ FROM metrics`.
