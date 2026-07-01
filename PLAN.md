# Plan: Phase 1 read-only query capability

## Overview

Build Phase 1 as a read-only data-plane mode for MCP clients. Provide
SQL and InfluxQL query tools, schema discovery tools, structured
responses, query safety checks, and lightweight telemetry.

Phase 1 helps an agent understand and query InfluxDB 3 data without
exposing write, admin, token-management, or host-level capabilities.

## Goals

- Provide safe read-only SQL and InfluxQL interfaces.
- Help agents discover databases, tables, and schemas before querying.
- Return structured responses that are easy for agents to use.
- Enforce read-only behavior in the MCP tool layer.
- Support InfluxDB 3 Enterprise preview JWT credentials as opaque bearer
  tokens for read-only tools.
- Keep the implementation small and extensible.

## End-user scenarios

### Analyst explores an unfamiliar database

An analyst connects Claude Desktop, Cursor, or another MCP client to an
InfluxDB 3 instance with a read-only profile and asks:

> Which sensors had the highest average temperature in the last 24
> hours?

With Phase 1, the agent can:

1. Call `list_databases` to see accessible databases.
2. Call `list_tables` and `describe_table` to discover measurements and
   columns.
3. Treat uncertain tag and field categories as `unknown`.
4. Build a bounded SQL query with `db`, `q`, and optional `params`.
5. Call `query_sql` with `json` output, or `jsonl` when row streaming is
   better for the client.
6. Return the result, the query, row count, truncation status, warnings,
   and correlation metadata.

The user gets a grounded answer and a reusable query. The agent explores
and queries data without seeing write, admin, token, or host-level tools.
For Enterprise deployments that use preview user auth, the same flow
works when the configured bearer credential is a JWT instead of an
`apiv3_` token.

### Operator investigates an existing InfluxQL dashboard query

An operator troubleshoots a dashboard panel that uses InfluxQL and asks:

> Why did this panel stop showing data after the deploy?

With Phase 1, the agent can:

1. Keep the user's query in InfluxQL and call `query_influxql`.
2. Use `SHOW` queries and schema discovery to verify the measurement and
   referenced columns.
3. Sample recent rows with bounded reads to distinguish missing data from
   a broken query.
4. Reject unsafe follow-up attempts, such as `SELECT INTO` or destructive
   statements.
5. Return `request_id`, `query_id`, and `query_id_source` so the operator
   can correlate the MCP result with `system.queries.id` when query
   history is available.
6. Emit structured logs to stderr for stdio transports so stdout remains
   reserved for MCP protocol messages.

The user gets a practical diagnosis, such as missing data, renamed
schema, a wrong time predicate, or a query failure. The investigation is
traceable without logging full query text by default.

## Tool surface

### `query_sql`

Run read-only SQL through the documented `/api/v3/query_sql` API. Keep
the MCP input names close to the API contract so examples and docs
translate directly.

#### Inputs

```ts
{
  db: string;
  q: string;
  params?: Record<string, unknown> | unknown[];
  format?: "json" | "jsonl" | "csv" | "pretty" | "parquet";
  maxRows?: number;      // MCP guardrail; default: 1000, hard max: 5000
  timeoutMs?: number;    // MCP guardrail, if supported by the client path
}
```

Default to `json`. Prefer `jsonl` when the client benefits from row
streaming. Treat `csv` and `pretty` as compatibility and debug formats.
Treat `parquet` as an advanced passthrough or artifact format.

#### Behavior

- Accept only read-only SQL.
- Reject multiple statements.
- Reject write and admin statements.
- Enforce bounded result sets.
- Pass `params` through to the query API.
- Return structured metadata.

#### Allowed statements

- `SELECT`
- `SHOW`
- `EXPLAIN`
- Read-only `WITH`

#### Rejected statements

- `INSERT`
- `UPDATE`
- `DELETE`
- `CREATE`
- `ALTER`
- `DROP`
- `COPY`
- `EXPORT`
- `ATTACH`
- Multi-statement SQL

### `query_influxql`

Run read-only InfluxQL through the documented `/api/v3/query_influxql`
API. Include this tool because InfluxQL remains a first-class InfluxDB 3
query language and many users already have InfluxQL queries.

#### Inputs

```ts
{
  db: string;
  q: string;
  params?: Record<string, unknown> | unknown[];
  format?: "json" | "jsonl" | "csv" | "pretty" | "parquet";
  maxRows?: number;      // MCP guardrail; default: 1000, hard max: 5000
  timeoutMs?: number;    // MCP guardrail, if supported by the client path
}
```

Use the same output defaults as `query_sql`: `json` for normal responses
and `jsonl` for row streaming.

#### Behavior

- Accept only read-only InfluxQL.
- Reject multiple statements.
- Reject write, mutation, admin, and destructive statements.
- Reject `SELECT INTO`.
- Enforce bounded result sets.
- Pass `params` through to the query API.
- Return the same response envelope and metadata shape as `query_sql`.

#### Allowed statements

- `SELECT`
- `SHOW`

#### Rejected statements

- `SELECT INTO`
- `DELETE`
- `DROP`
- `CREATE`
- `ALTER`
- `GRANT`
- `REVOKE`
- Multi-statement InfluxQL

### `list_databases`

Return accessible databases.

### `list_tables`

Return tables, also called measurements, in a database.

### `describe_table`

Return schema information from the metadata that InfluxDB 3 exposes
through SQL metadata and `SHOW` statements.

Include:

- Column name
- Data type
- Nullability, if available
- Category, when it can be determined without guessing
- Category confidence
- Source query and warnings

Use this category set:

```text
category = "time" | "tag" | "field" | "unknown"
```

Return `category = "unknown"` whenever tag and field roles cannot be
determined reliably. Do not infer tag or field status from column names
alone.

### `investigate_database`

Provide high-level discovery for a database.

#### Inputs

```ts
{
  db?: string;
  includeSamples?: boolean;
  includeCardinality?: boolean;
  maxTables?: number;
  sampleRowsPerTable?: number;
}
```

#### Behavior

- List databases.
- List tables.
- Describe schemas.
- Sample recent rows.
- Estimate tag cardinality only for columns known or strongly inferred to
  be tags, and only when inexpensive.
- Return warnings for wide schemas, unknown categories, and high
  cardinality.

## Tool advertisement

Support tool profiles:

```ts
type ToolProfile = "readonly" | "readwrite" | "operator";
```

Use this Phase 1 default:

```text
INFLUX_MCP_TOOL_PROFILE=readonly
```

Read-only deployments advertise only:

- `help`
- `health`
- Database discovery
- Schema discovery
- SQL query
- InfluxQL query
- Investigation

## Credential handling

Treat the configured InfluxDB bearer credential as opaque. Support both
existing `apiv3_` admin and resource tokens and, for InfluxDB Enterprise
only, experimental user-auth JWTs introduced in v3.10.

This support is credential compatibility for the read-only tool surface,
not a full auth feature. Pass the bearer credential through to InfluxDB
and let InfluxDB validate it. Drive tool advertisement from the configured
tool profile and the read-only surface. Do not rely on preview RBAC as
the only safety boundary.

Core does not have JWT user-auth support yet. Core read-only mode remains
a tool-layer guardrail over the configured token. Enterprise can also use
server-side authorization when the deployment uses a resource token or
user-auth JWT.

Do not implement login, logout, user management, role management,
OAuth/OIDC setup, token creation, or JWT lifecycle management in Phase 1.

## Query safety

Create a dedicated query safety service.

```ts
export interface QuerySafetyResult {
  ok: boolean;
  code?: string;
  message?: string;
  normalizedQuery?: string;
  warnings: QueryWarning[];
}
```

The service must:

1. Normalize SQL or InfluxQL.
2. Reject multiple statements.
3. Reject comments that hide additional statements.
4. Validate the first keyword for the query language.
5. Reject write and admin keywords.
6. Reject write-like constructs, such as InfluxQL `SELECT INTO`.
7. Enforce bounded results.
8. Warn about missing time predicates.

## Query service

Keep existing product routing. Add read-only wrappers:

```ts
querySqlReadOnly();
queryInfluxqlReadOnly();
```

Each wrapper must:

- Validate the query.
- Enforce limits.
- Execute the query.
- Normalize results.
- Return structured metadata.

## Schema discovery

Use documented query surfaces, such as `SHOW TABLES`, `SHOW COLUMNS`,
and `information_schema.columns`, plus product-specific metadata only
where it is available.

Return `category = "unknown"` when tag and field roles cannot be
determined reliably. Include a warning so the agent does not make
tag-specific or field-specific assumptions for that column.

## Telemetry

### Log fields

Log these fields for read-only tool calls:

- `tool_name`
- `request_id`
- `query_id`
- `timestamp_ms`
- `duration_ms`
- `db`
- `row_count`
- `truncated`
- `success`
- `error_code`

`request_id` is the MCP or server correlation ID. `query_id` should align
with InfluxDB server-side query history when available. Use the `id`
column from `system.queries`. If the server-side ID is not available,
generate an MCP-local query ID and mark it as local metadata.

When server-side query history is available, preserve the
`system.queries` field names for query metadata:

- `id`
- `phase`
- `issue_time`
- `query_type`
- `success`
- `running`
- `cancelled`
- `plan_duration`
- `permit_duration`
- `execute_duration`
- `end2end_duration`
- `compute_duration`
- `max_memory`

Keep `duration_ms`, `row_count`, and `truncated` as MCP-local execution
metadata.

### Defaults

```text
MCP_LOG_TOOL_CALLS=true
MCP_LOG_QUERY_TEXT=false
MCP_LOG_BACKEND=stderr
MCP_INJECT_QUERY_ID=false
```

For stdio MCP transports, write structured logs to stderr so stdout
remains reserved for MCP protocol messages. Allow stdout logging only for
transports where stdout is not the protocol channel, such as an HTTP
server process with explicit log routing.

Do not log full query text by default. If query text logging is enabled,
make clear that InfluxDB server-side history may still include query text
independently of MCP logging.

## Response shape

Return successful query responses in this shape:

```json
{
  "ok": true,
  "db": "metrics",
  "q": "...",
  "format": "json",
  "rows": [],
  "metadata": {
    "request_id": "...",
    "query_id": "...",
    "query_id_source": "system.queries.id",
    "phase": "success",
    "query_type": "sql",
    "success": true,
    "duration_ms": 42,
    "row_count": 128,
    "truncated": false
  },
  "warnings": []
}
```

Return safety errors in this shape:

```json
{
  "ok": false,
  "error": {
    "code": "not_read_only",
    "message": "query_sql only runs read-only SQL.",
    "retryable": false,
    "fix": "Use SELECT, SHOW, or EXPLAIN."
  }
}
```

## Test plan

### Fixtures

Use a local InfluxDB 3 Core instance with a deterministic seed database:

- One table with `time`, at least one tag-like string column, and numeric
  fields.
- One wide table for schema warning behavior.
- Enough rows to verify truncation and `maxRows`.

When Enterprise is available in CI or a nightly environment, run the same
read-only tests with a resource token and with a preview user-auth JWT.
Core tests validate the tool-layer guardrail because Core MCP setup uses
an admin token.

### Unit tests

Verify the query safety service without a running server:

- SQL `SELECT`, `SHOW`, `EXPLAIN`, and read-only `WITH` pass.
- InfluxQL `SELECT` and `SHOW` pass.
- Write, admin, destructive, and mutation statements fail.
- InfluxQL `SELECT INTO` fails.
- Multi-statement input fails, including comment-obscured statements.
- Missing or excessive bounds are normalized or rejected consistently.
- `format` defaults to `json`; `jsonl` is accepted as the streaming
  default path.
- SQL and InfluxQL `params` are preserved for API passthrough.
- Errors include stable `code`, user-facing `message`, `retryable`, and
  `fix`.

### Protocol tests

Verify MCP behavior at the tool boundary:

- `INFLUX_MCP_TOOL_PROFILE=readonly` advertises only read-only tools.
- Tool schemas use API-aligned `db`, `q`, `params`, and `format`.
- Write, admin, token, and host-tier tools are absent from the read-only
  catalog.
- Bearer credential handling accepts both `apiv3_` tokens and
  Enterprise JWT-shaped credentials without prefix-specific rejection.
- Stdio transport emits MCP protocol messages on stdout only.
- Structured logs go to stderr by default.

### Integration tests

Run these tests against the seeded Core instance:

- `query_sql` executes bounded `SELECT`, `SHOW TABLES`, and
  `information_schema.columns` queries.
- `query_sql` accepts parameterized SQL through `params`.
- `query_influxql` executes bounded `SELECT` and `SHOW` queries.
- Rejected SQL and InfluxQL return structured safety errors and do not
  reach the query API.
- `maxRows` truncates oversized results and sets `truncated=true`.
- Default `json` responses parse as JSON.
- `jsonl` responses parse one row per line.
- `csv` and `pretty` are treated as compatibility and debug formats.
- `parquet` is passed through only where the client can handle an
  artifact response.

When an Enterprise fixture with preview user auth is available:

- The same read-only SQL, InfluxQL, discovery, and investigation tests
  pass with a JWT bearer credential.
- Configuring the MCP server with only a valid JWT bearer credential
  succeeds without requiring an `apiv3_` token prefix.
- The JWT is forwarded as the InfluxDB bearer credential for
  `query_sql`, `query_influxql`, `list_databases`, `list_tables`, and
  `describe_table`.
- Expired or invalid JWTs return structured authentication errors.
- Authorization failures from Enterprise are preserved as structured tool
  errors without retrying with a broader credential.

### Schema discovery tests

Verify discovery behavior against the seed database:

- `list_databases` returns only accessible databases.
- `list_tables` returns user tables and handles empty databases.
- `describe_table` uses documented metadata surfaces, such as
  `SHOW COLUMNS` and `information_schema.columns`.
- `describe_table` returns `category="time"` for the time column.
- Columns without reliable tag or field evidence return
  `category="unknown"` with a warning.
- Category inference does not rely on column names alone.
- `investigate_database` respects `maxTables` and `sampleRowsPerTable`.
- Cardinality checks run only for known or strongly inferred tag columns.

### Telemetry tests

Verify lightweight observability without leaking data by default:

- Every tool call logs `tool_name`, `request_id`, timestamp, duration,
  success, and `error_code`.
- Query tools log `db`, `row_count`, and `truncated` when available.
- Safety rejections are logged without full query text by default.
- Successful queries return `request_id`, `query_id`, `query_id_source`,
  duration, row count, and truncation metadata.
- `query_id` maps to `system.queries.id` when server-side history is
  available.
- Local fallback query IDs are marked so users do not expect them in
  `system.queries`.

### CI expectations

- Run unit and protocol tests on every pull request.
- Run Core integration tests on every pull request when the local server
  fixture is available.
- Run Enterprise resource-token and preview-JWT tests in nightly or
  release-blocking CI until an Enterprise fixture is cheap enough for
  every pull request.

## Deferred work

Do not include these capabilities in Phase 1:

- Write operations
- Database administration
- Token management
- Login, logout, and JWT issuance
- User and role management
- OAuth/OIDC setup
- Processing Engine plugins
- Loki backend
- File logging
- Multiple logging backends
- Grafana dashboards
- Advanced audit and compliance guarantees

## Acceptance criteria

Phase 1 is complete when:

- Read-only deployments expose only read-only tools.
- `query_sql` rejects non-read-only SQL.
- `query_influxql` rejects non-read-only InfluxQL.
- Responses are structured.
- Investigation tools return structured metadata.
- Query safety is enforced.
- Enterprise JWT bearer credentials work for read-only tools when user
  auth is enabled.
- Integration tests pass.
- Lightweight structured telemetry is available.

## Implementation order

1. Add tool profile support.
2. Add credential handling for opaque bearer tokens.
3. Add `query_sql`.
4. Add `query_influxql`.
5. Add the query safety service.
6. Add structured responses.
7. Add `list_tables`.
8. Add `describe_table`.
9. Add `investigate_database`.
10. Add telemetry.
11. Add tests.
