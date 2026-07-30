Query executed via InfluxQL (`SELECT /cpu.*usage/ FROM metrics`) against database `host_system`. Results:

**Rows (13):**

| time | cpu::usage_idle | cpu::usage_sys | cpu::usage_system | cpu::usage_user |
|---|---|---|---|---|
| 1970-01-01T00:00:01 | 32.7 | 12.1 | – | 55.2 |
| 2026-07-23T17:15:26 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:15:26 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:19:48 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:19:48 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:23:48 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:23:48 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:25:38 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:25:38 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:27:45 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:27:45 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-30T04:26:03 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-30T04:26:03 | 45.2 | – | 9.7 | 45.1 |

**Query metadata:**
- query_type: influxql, success: true, duration_ms: 87
- row_count: 13, truncated: false
- warnings: `limit_added` (LIMIT 1000 auto-applied), `missing_time_predicate` (no time filter in query)

Note the schema is inconsistent — the earliest row uses `cpu::usage_sys` while later rows use `cpu::usage_system` (regex matched both as separate fields).
