The regex query got the CPU fields back. The first query returned nothing because InfluxQL reads `"cpu::usage*"` as one exact field name, and no field has that name. It did not report an error.

**get_help heading:** `INFLUXDB 3 MCP SERVER HELP`

**Steps:**
1. I ran `SELECT "cpu::usage*" FROM metrics LIMIT 2` with `query_influxql`. It succeeded with `row_count: 0` and only a `missing_time_predicate` warning.
2. I ran `describe_table` on `metrics`. It lists three Float64 columns: `cpu::usage_idle`, `cpu::usage_system` and `cpu::usage_user`. The `host` column is a dictionary type. Metadata does not say which columns are tags and which are fields.
3. I ran `SELECT /^cpu::usage/ FROM metrics LIMIT 2` with `query_influxql`. It returned all three CPU fields.

**Rows:**
```json
[
  {"iox::measurement":"metrics","time":"2026-01-01T00:00:00","cpu::usage_idle":84.3,"cpu::usage_system":3.2,"cpu::usage_user":12.5},
  {"iox::measurement":"metrics","time":"2026-01-01T00:00:00","cpu::usage_idle":45.2,"cpu::usage_system":9.7,"cpu::usage_user":45.1}
]
```

**Metadata:**
```json
{
  "request_id":"598dc331-8ea3-402c-b656-48489969b9a4",
  "query_id":"771ceb06-7fc3-4f7a-ab24-820a9a67bbaa",
  "query_id_source":"system.queries.id",
  "phase":"success","query_type":"influxql","success":true,
  "duration_ms":29,"row_count":2,"truncated":false,"running":false,"cancelled":false,
  "plan_duration":"PT0.020779802S","permit_duration":"PT0.000019369S",
  "execute_duration":"PT0.000489814S","end2end_duration":"PT0.021378875S",
  "compute_duration":"PT0.000000007S","max_memory":0
}
```
It also returned the `missing_time_predicate` warning because the query has no time filter.

**Tool choice:** I used `query_influxql` because you asked for InfluxQL regex field selection, and only InfluxQL supports it. SQL has no regex field selection; there I would have to list the three columns by name and run it with `query_sql`.

**Flux:** Not supported. The help says "InfluxDB 3 supports both SQL and InfluxQL. Flux is not supported."

Nothing was changed. All four calls were reads.

`★ Insight ─────────────────────────────────────`
- In InfluxQL, double quotes mark an exact identifier, so `*` inside them is a literal character. To match by pattern, use an unquoted `/regex/`.
- The empty result came back marked as a success, so a row count of 0 is the only sign the query missed. When rows are unexpectedly empty, check the schema before assuming there is no data.
- Both rows share the same timestamp and probably come from different hosts. Add `host` to the select or a `GROUP BY host` to tell them apart.
`─────────────────────────────────────────────────`
