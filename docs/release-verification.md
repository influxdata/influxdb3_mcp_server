# Verify a release candidate

Run the existing lint, formatting, version-consistency, build, and test checks
through one command:

```sh
npm ci
npm run verify:candidate
```

`verify:candidate` uses the same commands as CI and adds the repository's lint
check. `npm test` runs the build through its existing `pretest` hook.
CI also validates MCP Registry metadata with `mcp-publisher`.
Wait for all CI jobs at the exact candidate commit before starting capability evals.

## Verify installable artifacts

Configure a live test database with `INFLUX_DB_INSTANCE_URL`, `INFLUX_DB_TOKEN`,
and `INFLUX_DB_PRODUCT_TYPE`. Set `INFLUX_TEST_DATABASE` if the database isn't
`smoke`. Supply credentials through your existing secret-management environment.

Set `INFLUX_DOCKER_INSTANCE_URL` to the same instance's URL as reached from Docker.
On Docker Desktop, a host-local instance usually uses `host.docker.internal`
instead of `127.0.0.1`.

```sh
npm run verify:artifacts
```

The command builds with `npm run build`, packs with `npm pack`, and installs the
tarball in a temporary directory. It then builds the existing `Dockerfile` and
checks both artifacts through the same MCP smoke script. It publishes nothing.
The temporary package installation is removed; the local verification image is
retained for inspection. The summary records the package integrity and image ID.
Run once per supported live product to verify each product's behavior.

Both artifacts must initialize with the version in `package.json`, expose the
required query and discovery tools, and execute a bounded read-only query.
The checker exercises `readonly`, `readwrite`, and `operator` profiles and checks
one successful telemetry event per query. The installed package must also include
the output-contract document referenced by its README.
The current `readwrite` and `operator` profiles expose the same tools.
The smoke check invokes no write or administration tools.

You can also check an existing installation or image directly:

```sh
npm run smoke:server -- /path/to/node_modules/.bin/influxdb-mcp-server
npm run smoke:server -- --docker IMAGE
```

For the direct Docker command, `INFLUX_DB_INSTANCE_URL` must already be reachable
from inside Docker. No version numbers need editing between releases.
Update smoke assertions only when the supported contract intentionally changes.

## Freeze before capability evals

Record the exact MCP commit, runner commit, dependency lockfile, database image
IDs, fixture counts, selected models, case manifest, and prompt hashes.
Use the same fixtures and explicit model per harness for baseline and candidate.
Historical runs with unknown actual models don't establish a comparable baseline.
Authentication and model-access preflights must succeed before starting the batch.

Keep the candidate fixed while grading. Distinguish completion from graded pass
rates, and resolve pending reviews before applying the capability release gate.
After a candidate change, use the affected contracts to decide which runs need
repeating. Artifact checks are reusable; they don't replace capability evals or
verification of the exact published artifacts after release.
