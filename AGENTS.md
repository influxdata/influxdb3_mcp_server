# Project Development Guidance

## Agent-Facing Database Tools

- Database API: source of truth; returns raw error and query ID.
- MCP tool: agent UX layer; classifies common recoverable errors and suggests the next MCP action.
- Tool description: tells the model how to use that hint and avoid trying SQL plus InfluxQL plus another SQL query in one wander.

For SQL quoted wildcard recovery, prefer this order:

1. Call `describe_table` when `query_sql` returns a quoted wildcard or unknown-field recovery hint.
2. Expand matching fields explicitly from the schema.
3. Run one bounded `query_sql`.
4. Use `query_influxql` regex only when the user explicitly asks for InfluxQL or regex field selection.

For known database and table prompts such as `host_system.metrics` with `"cpu::usage*"`, the ideal path is `list_databases`, `list_tables`, `describe_table`, then one bounded `query_sql` with explicit fields. If `describe_table` already proves the expansion, skip the doomed literal wildcard query.
