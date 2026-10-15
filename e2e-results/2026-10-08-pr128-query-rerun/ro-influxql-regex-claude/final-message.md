The query returned 3 `cpu::usage` fields and 2 rows. Query used: `SELECT /^cpu::usage/ FROM metrics LIMIT 100`

| time | cpu::usage_idle | cpu::usage_system | cpu::usage_user |
|---|---|---|---|
| 2026-01-01T00:00:00 | 84.3 | 3.2 | 12.5 |
| 2026-01-01T00:00:00 | 45.2 | 9.7 | 45.1 |

Both rows have the same timestamp. That probably means two series with different tag values, such as two hosts. Tags were not selected, so the output can't show which row belongs to which series. Add `GROUP BY *` to see the tag values.

The query had no time filter. MCP gave a `missing_time_predicate` warning. This table has only 2 rows, so the full scan cost nothing.

`★ Insight ─────────────────────────────────────`
- InfluxQL regex field selection (`/^cpu::usage/`) has no direct SQL equivalent. In SQL you must list each field by name.
- In InfluxQL, `::` normally means a type cast, as in `field::float`. Inside a regex it is plain text, so it matched the literal `cpu::` prefix.
`─────────────────────────────────────────────────`
