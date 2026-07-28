Query executed against `host_system.metrics` using InfluxQL regex field selection (`/^cpu::usage/`).

**Rows (11 returned, JSON):**

| time | cpu::usage_idle | cpu::usage_sys | cpu::usage_system | cpu::usage_user |
|---|---|---|---|---|
| 1970-01-01T00:00:01 | 32.7 | 12.1 | – | 55.2 |
| 2026-07-23T17:15:26 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:15:26 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:19:48 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:19:48 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:23:48 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:23:48 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:25:38 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:25:38 | 45.2 | – | 9.7 | 45.1 |
| 2026-07-23T17:27:45 | 84.3 | – | 3.2 | 12.5 |
| 2026-07-23T17:27:45 | 45.2 | – | 9.7 | 45.1 |

Note: field naming is inconsistent across rows — the earliest row uses `cpu::usage_sys`, all later rows use `cpu::usage_system`.

**Query metadata:**
- query_type: influxql, success: true, row_count: 11, truncated: false
- duration_ms: 75 (end2end: ~38.3ms compute+plan)
- warnings: `limit_added` (LIMIT 1000 auto-applied), `missing_time_predicate` (no time bound specified)
