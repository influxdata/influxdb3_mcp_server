Regex recovery worked: `SELECT /^cpu::usage/ FROM metrics LIMIT 2` returned 2 rows with all 3 CPU fields.

**get_help heading:** `INFLUXDB 3 MCP SERVER HELP`

**First attempt:** `SELECT "cpu::usage*" FROM metrics LIMIT 2` succeeded but returned 0 rows. In InfluxQL, double quotes make an exact identifier, so `*` is a literal character, not a wildcard. No column has that exact name. Query ID was `d44096c1-226b-4783-a7df-1f1d40915d7c`.

**Schema (`describe_table`):** `cpu::usage_idle`, `cpu::usage_system` and `cpu::usage_user` (all Float64), plus `host` (Dictionary) and `time`. The metadata did not say which columns are tags and which are fields.

**Recovered rows:**
```json
[
  {"iox::measurement":"metrics","time":"2026-01-01T00:00:00","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"iox::measurement":"metrics","time":"2026-01-01T00:00:00","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1}
]
```

**Metadata:**
```json
{"request_id":"657784fe-2c3e-48bf-8b12-22609a0d0adf","query_id":"b85abfa0-d85e-4f47-b428-9a6a19a09566","query_type":"influxql","phase":"success","success":true,"duration_ms":24,"row_count":2,"truncated":false,"plan_duration":"PT0.014215264S","execute_duration":"PT0.000421151S","end2end_duration":"PT0.014742067S"}
```
Warning: `missing_time_predicate`. The query has no time filter.

**Tool choice:** I used `query_influxql` because you asked for InfluxQL and regex field selection. `query_sql` has no regex column selection, so it would need the three names listed by hand.

**Flux:** not supported. The help text says: "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

**Caveat:** The regex returned only the CPU columns, so `host` is missing. Both rows have the same timestamp and are probably from different hosts. To tell them apart, add `GROUP BY host` or include `host` in the select.

Nothing was changed. All calls were read-only.
