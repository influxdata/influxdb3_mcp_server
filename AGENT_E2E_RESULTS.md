# Agent E2E Results

This file records summarized results from real Codex MCP-agent runs. Do not
store API tokens, raw transcripts, or full command lines here.

## Summary

| Date       | Test case               | Server mode | MCP server key             | Reasoning | Tool calls | Failed calls | Tokens | Result |
| ---------- | ----------------------- | ----------- | -------------------------- | --------- | ---------: | -----------: | -----: | ------ |
| 2026-07-02 | `ro-wildcard-field-low` | default     | `influxdb3_ent_mcp_dev`    | low       |          4 |            1 | 23,483 | Passed |
| 2026-07-02 | `ro-wildcard-field-low` | read-only   | `influxdb3_ent_ro_mcp_dev` | low       |         10 |            0 | 27,031 | Passed |
| 2026-07-02 | `ro-wildcard-field-low` | read-only   | `influxdb3_ent_ro_mcp_dev` | low       |          5 |            0 | 24,335 | Passed |
| 2026-07-02 | `ro-wildcard-field-low` | default     | `influxdb3_ent_mcp_dev`    | low       |          4 |            0 | 24,453 | Passed |

## Run Notes

### `ro-wildcard-field-low`, Before Guidance Tuning

Default mode recovered from a failed literal SQL query by expanding fields from
the error message. This was efficient but less grounded in schema metadata.

Read-only mode succeeded, but overworked the recovery path. It inspected schema,
tried InfluxQL literal selection, tried InfluxQL regex selection, and then ran
an extra SQL query. This increased tool calls and token usage.

### `ro-wildcard-field-low`, After Guidance Tuning

Both modes followed the intended recovery path:

1. List databases.
2. List tables for `host_system`.
3. Describe `host_system.metrics`.
4. Expand `cpu::usage*` from schema.
5. Run one bounded `query_sql` with explicit fields.

The read-only run also called `load_database_context`, which accounts for its
extra tool call. Token usage was effectively tied.

## Excluded Runs

These summaries exclude runs with invalid profile setup, including cases where
both servers were accidentally configured as read-only or where an inline
override referenced the wrong MCP server key and produced `invalid transport`.
