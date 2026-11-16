# Local sensor-temperature demo

This disposable InfluxDB 3 Core instance listens on port 8181. It uses an
in-memory object store and a public example token. Do not use this token with
a persistent or remote database.

From this directory, with Docker and Node.js 22.23.4+, 24.22.1+, or 26.12.1+:

```sh
docker compose up -d
node seed.mjs
```

The seed writes 72 points, 24 hourly readings for each of three sensors, from
30 minutes to 23.5 hours before seeding. Run the query soon after seeding.
Recreate the disposable container for a fresh run.

Configure your MCP client with the repository's `example-npx.mcp.json`, replacing
`<YOUR_INFLUXDB_OPERATOR_TOKEN>` with `apiv3_sensor_demo`. Or build this checkout
with `pnpm install && pnpm run build` and use `example-local.mcp.json` after
replacing its absolute entrypoint path. Both examples select the `readonly`
tool profile. The npx example pins server version 2.0.1.

Ask the agent:

> Discover the available databases and tables. Inspect the schema. Which
> sensors had the highest average temperature in the last 24 hours? Show the
> SQL, row count, completeness status, and any material warnings.

The agent should call `list_databases`, `list_tables`, `describe_table`, then
`query_sql` with `db: "sensor_demo"` and a bounded query such as:

```sql
SELECT sensor, AVG(value) AS avg_temperature
FROM temperature
WHERE time >= now() - INTERVAL '24 hours'
GROUP BY sensor
ORDER BY avg_temperature DESC
LIMIT 10
```

Expected order is `beta` (28), `gamma` (24), `alpha` (21). The expected
`metadata.row_count` is 3 and `metadata.completeness` is `complete`, because
three groups are below the query's limit of 10. Report the actual metadata,
not this expectation, if the response differs. If completeness is `capped`,
include `metadata.cap`, `metadata.cap_source`, and material warnings such as
`limit_reached`. If it is `interrupted`, say the returned rows are partial.
See the [read-only output contract](../../docs/read-only-output-contract.md).

For a direct database check, use the same query through the InfluxDB API:

```sh
curl -fsS -G 'http://localhost:8181/api/v3/query_sql' \
  -H 'Authorization: Bearer apiv3_sensor_demo' \
  --data-urlencode 'db=sensor_demo' \
  --data-urlencode "q=SELECT sensor, AVG(value) AS avg_temperature FROM temperature WHERE time >= now() - INTERVAL '24 hours' GROUP BY sensor ORDER BY avg_temperature DESC LIMIT 10"
```

Stop and discard the instance with `docker compose down`.
