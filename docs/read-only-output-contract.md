# Read-only query output contract

- Status: Draft for review (#131)
- Applies to: `query_sql`, `query_influxql`
- Schema: [`schemas/read-only-response.schema.json`](../schemas/read-only-response.schema.json)

This contract says which parts of a read-only query response an agent's
final answer must carry, and which it may leave out. Graders use it to judge
answers. The tool descriptions point to the agent-facing copy in `get_help`
("READING QUERY RESULTS") rather than restating it.

## Must reach the final answer

| Response field                        | What the answer says                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metadata.completeness`               | Whether the result is complete, capped, or interrupted. A complete result needs no comment. A capped or interrupted one must be called out.                                                                                    |
| `metadata.cap`, `metadata.cap_source` | For a capped result, the row bound and whether it came from the server's bound (`server_bound`) or the query's own `LIMIT` (`query_limit`). That tells the reader which one to change.                                         |
| `metadata.row_count`                  | How many rows the answer is based on. For CSV and JSONL, it counts records, not payload items.                                                                                                                                 |
| `warnings`                            | Each warning that changes how the result reads. Examples: `limit_added`, `limit_reached` (the result may have more rows), `missing_time_predicate`, `format_mismatch` (the server returned a different format than requested). |
| `error.code`, `error.message`         | For a failure, what failed. "Query failed" and "no rows" must read differently.                                                                                                                                                |
| `rows` on an error                    | For an interrupted result, the answer may use the rows received, and must say that they are partial.                                                                                                                           |

An empty successful result is "no rows matched". It is never evidence that a
table or database is missing, and a failed query is never "no data".

## May be left out unless asked

- `metadata.request_id`, `metadata.query_id`, `metadata.query_id_source`
- `metadata.duration_ms` and the other timings
- The echoed `q`, unless the reader needs it to rerun or adjust the query

## Raw output

Answer conversationally by default; don't paste raw JSON. When the user asks
for JSON, return the rows as returned and keep the metadata fields above
intact. Don't rename or drop them, and don't re-derive completeness from the
row count.

## Changing this contract

The response envelope is additive: new fields can be added, and existing
fields are not renamed or removed. A change to what must reach the answer
updates this file, the "READING QUERY RESULTS" help section, and the grading
criteria together.
