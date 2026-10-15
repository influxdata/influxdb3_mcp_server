# Verify discovery, investigation, and recovery

The implementation starts at MCP commit `875d600`. Build the reviewed PR head
for each operator run and record that commit with the results. The live checks
below remain pending until their results are recorded.

## Review the changed contracts

- Query and discovery errors preserve normalized HTTP status and distinguish
  `credential_invalid`, `access_denied`, and `not_found_or_denied`. A 404 stays
  ambiguous until a live route establishes what it means. Unavailable schema
  metadata uses `metadata_unavailable`.
- Errors include `recovery` and derive `retryable` from it. Known invalid
  credentials request renewal. The recorded Core unknown-field error requests
  reference correction. Unobserved signatures use `none`, including synthetic
  405, 429, 503, and timeout responses. `Retry-After` is preserved in milliseconds
  when supplied; its presence alone does not authorize a retry.
  Local HTTP transport timeouts report `client_timeout` and
  `timeout_origin: "client"`, without inventing an HTTP response status.
- `health_check` now returns JSON. It reports per-check outcomes. Endpoint
  authorization failures leave health unknown; SDK initialization cannot prove
  the instance healthy. Status and config resources use the same distinction.
- Database lists report visibility as `unknown`. Listing a database does not
  establish permission to read it. Help and config resources distinguish
  configured capabilities from observed calls and unknown permissions.
- Investigation sorts visible table names before applying `maxTables`, reports
  the visible total and truncation, and preserves each table's result. A schema
  failure marks that table `failed`; a sample failure preserves the schema and
  marks the table `partial`. Summaries include failures and warnings.
- Samples use a fixed window ending at investigation start, defaulting to 24
  hours. `sampleWindowHours` accepts integers from 1 through 8760. Samples use
  `ORDER BY time DESC` and the existing read-only row limit. An empty window is
  `no_rows_in_window`, not evidence that the table is empty.
- Investigation reserves one list request plus two schema requests per table
  and, when sampling, two requests for the sample and optional history lookup.
  The budget reports an upper bound, including failed calls. `maxTables` stops
  the traversal. `includeCardinality: true` returns `unsupported_option` and
  remains absent from the advertised working options.
- Column roles include their source. Existing server metadata establishes Cloud
  tag and field roles; time-name inference is labeled `inferred`. Schema mode
  and deletion status remain `unknown`. Timestamp-shaped suffixes produce an
  advisory `possibly_deleted` warning and never remove a table.
- Both read-only query tools accept `database` for `db` and `query` for `q`.
  Equal pairs work; conflicting pairs fail. Canonical names remain supported.
  Validation failures return structured `invalid_arguments` tool results and
  exactly one telemetry event. This changes the previous protocol rejection.
- `EXPLAIN ANALYZE` bounds its inner query through the safety check and includes
  a `diagnostic_execution` warning. `EXPLAIN` remains available for plan checks.

## Run local checks

```sh
npm ci
npm run build
npm run lint
npm test
```

The fake HTTP helper and named access and recovery scenarios live under
`tests/helpers/` and `tests/fixtures/`. Their provenance is explicitly synthetic.
They do not establish product compatibility. Pinned OpenAPI excerpts record the
public source commit; the scenario contract reports documented spec omissions.
To refresh the excerpts from a public docs checkout, install PyYAML and run:

```sh
python3 scripts/snapshot-protocol-openapi.py /path/to/docs-v2
```

## Run operator checks

Run these after local review on the reviewed implementation commit. Do not run
the full historical integration suite with a scoped credential; some older tests
create and delete fixtures. The new tests below perform reads only.

| Target                   | Session URL                                      | Product      | Credential variable                 | Run                          |
| ------------------------ | ------------------------------------------------ | ------------ | ----------------------------------- | ---------------------------- |
| Core                     | `http://influxdb3-core:8181`                     | `core`       | `INFLUXDB3_CORE_TOKEN`              | Read-only contracts          |
| Enterprise node0         | `http://influxdb3-enterprise:8181`               | `enterprise` | `INFLUXDB3_ENTERPRISE_TOKEN`        | Read-only contracts          |
| Enterprise node0, scoped | Same as node0                                    | `enterprise` | `INFLUXDB3_ENTERPRISE_SCOPED_TOKEN` | Scoped access                |
| Enterprise ingest-only   | `http://influxdb3-enterprise-verify-ingest:8181` | `enterprise` | `INFLUXDB3_ENTERPRISE_TOKEN`        | Record query status and body |

On the host, the corresponding ports are 8282, 8181, and 8185. Record the server
version, MCP commit, target, authentication mode, and raw response for every run.
Use the appropriate token variable without printing it. For Core, for example:

```sh
INFLUX_TEST_ENABLED=true \
INFLUX_DB_INSTANCE_URL=http://influxdb3-core:8181 \
INFLUX_DB_PRODUCT_TYPE=core \
INFLUX_DB_TOKEN="$INFLUXDB3_CORE_TOKEN" \
npx vitest run tests/readonly-contract-protocol.test.ts
```

Repeat with Enterprise's URL, product, and admin credential. The shared contract
test expects a readable table in `smoke`; set `INFLUX_TEST_DATABASE` to another
seeded database if needed. Expect valid response envelopes, reported sampling
windows and truncation, structured validation failures, and one telemetry event
per call. If no recent sample exists, expect `no_rows_in_window`.

Run the scoped check separately:

```sh
INFLUX_TEST_ENABLED=true INFLUX_TEST_SCOPED=true \
INFLUX_DB_INSTANCE_URL=http://influxdb3-enterprise:8181 \
INFLUX_DB_PRODUCT_TYPE=enterprise \
INFLUX_DB_TOKEN="$INFLUXDB3_ENTERPRISE_SCOPED_TOKEN" \
npx vitest run tests/permission-scoped-live.test.ts
```

Expect readable `smoke`, denied or explicitly ambiguous access to `host_system`,
and readable `smoke` again after the failed calls. Both health checks may be
denied without declaring the instance down. Confirm the actual 401, 403, and 404
responses on each product before updating scenario provenance or narrowing 404.

For the ingest-only node, record SQL and InfluxQL errors through the MCP tools.
Do not infer query mode from 405 until its version and body are observed. Record
server timeout and backpressure responses, including `Retry-After`, before adding
recovery mappings. Client timeout and server timeout must remain distinct.

## Leave unavailable checks pending

- Enterprise 3.12.1 user JWT tests need user authentication configured on the
  operator's testbench. Scoped API tokens do not establish JWT compatibility.
- Core and Enterprise 3.12.1 metadata tests need live observations of the metadata
  available to each credential. No new catalog endpoint or permission probe is
  assumed by this change.
- A live tombstone check needs an isolated seeded database. Partial table access
  remains fake-only unless the testbench can deny one table in a readable database.
- Exhaustion, queue timeout, wrong-node, and backpressure recovery mappings remain
  pending recorded version-specific responses. The fake cases verify conservative
  fallback behavior only.
- Run the agent cases `ro-scoped-denied`, `ro-input-contract`, and `ro-wrong-node`
  on their corresponding operator testbench profiles. Add recent-sample, table
  truncation, and tombstone cases when fixtures exist. Agent results are absent
  until those runs are recorded and graded.

## Integrate with P1

Review shared edits in `query.service.ts`, `query-safety.service.ts`,
`query.tools.ts`, `response.ts`, and the response envelope schema. Preserve P1's
completeness and format behavior while adding access outcomes and aliases.
Investigation retains the sample's full metadata and warnings, so P1's final
completeness fields can pass through. Run all protocol tests on the combined
implementation; separate passing runs do not establish integration success.
