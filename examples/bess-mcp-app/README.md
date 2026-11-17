# BESS MCP App example

Investigate live battery-energy-storage-system data with the InfluxDB 3 MCP
server and a visual MCP App. A local simulator writes seeded telemetry for four
battery packs, with 192 cells per pack. A separate read credential supplies the
App's live view and the agent's database tools.

The **Ask agent** button sends an editable prompt to a real agent. In the
included browser host, this starts a Codex CLI run. The agent inspects the schema
and chooses its own tools and SQL. Its answer and actual tool arguments appear
in the App. No fixed investigation or recorded answer substitutes for that run.

The telemetry panel is a separate dashboard read with inspectable SQL and
response metadata. It uses a bounded standard SQL query; no caches or
Processing Engine plugins are required. The telemetry and 70°C threshold are
for demonstration, not physical battery diagnosis.

## Prerequisites

- A built checkout of this repository and a Node.js version supported by its
  `package.json`.
- Python 3.10 or later for the simulator, which uses the standard library.
- An existing InfluxDB 3 Enterprise or InfluxDB 3 Cloud database. Use the
  Enterprise product type for InfluxDB 3 Cloud.
- Separate database tokens: read/write for the simulator, read-only for the App
  and agent. The simulator needs read access for its startup database check.
- An installed and authenticated [Codex CLI](https://developers.openai.com/codex/cli/)
  for the browser host's agent action. Set `CODEX_BIN` if it is not on `PATH`.

The `readonly` profile limits which MCP tools are exposed. The database token
provides the separate access boundary. The full MCP server also supports write
and administration tools. InfluxDB 3 Core can run the example with an operator
token, but does not provide the same database-enforced read-only token boundary.

## Configure the example

From the repository root, install and build the MCP server:

```sh
pnpm install
pnpm run build
cd examples/bess-mcp-app
npm ci
cp connection.example.json connection.json
mkdir -p .secrets
chmod 700 .secrets
```

Edit `connection.json` with your database host, database name, and `product`:
`enterprise` or `core`. The file contains no token and is ignored by Git so
local connection details stay local. The database must already exist.

Save the read token in `.secrets/read.json` and the simulator token in
`.secrets/write.json`, each with this shape:

```json
{ "token": "<YOUR_TOKEN>" }
```

Give the files owner-only permissions:

```sh
chmod 600 .secrets/read.json .secrets/write.json
```

Alternatively, `INFLUXDB_READ_TOKEN_FILE` and `INFLUXDB_WRITE_TOKEN_FILE` can
point to existing JSON credential files. The simulator alone reads the writer
file. The MCP launcher reads only the reader file. Token values are not placed
in browser code, agent prompts, or process arguments.

## Feed BESS data

Start the simulator in a terminal:

```sh
python3 simulate.py run
```

It checks the selected database before writing and emits batches of 773 readings
approximately once per second: 768 cells, four packs, and one inverter. Stop with Ctrl+C, or add
`--duration 300` for a bounded five-minute run. With implicit schemas, the first
write creates the three telemetry tables. For an explicit-schema database,
create compatible tables before starting the simulator.

In another terminal, build and start the App:

```sh
npm run build
npm start
```

Open <http://127.0.0.1:8091/>. Set `PORT` to use another local port. The browser
host listens only on `127.0.0.1`; it is a local example, not a hosted service.

Ask the agent:

> Which battery pack needs attention? Inspect the schema and fresh cell
> readings. Show the SQL and result completeness.

The host starts a fresh Codex conversation for each question, with the readonly
MCP server, a read-only sandbox, and shell tools disabled. Tool approval
requests use automatic review. Runs are limited to three minutes and one at a
time. If the agent cannot run or finish, the App displays the failure.

### Trigger a repeatable event

In the included browser host, click **Trigger hot cell**. The view refreshes
after the cell heats up. Click **Ask agent** to investigate, then **Reset scenario**
to return to normal temperatures and compare the agent's answer. The button's
heating event lasts ten minutes and resets automatically. Keep the simulator running.

These host controls update only the local simulator scenario file. They do not
write directly to the database or add tools to the agent. Other MCP Apps hosts
can use the terminal controls instead.

To trigger an event from a terminal while the simulator runs:

```sh
python3 simulate.py heat --duration 180
```

The temperature of `pack-0 / mod-3 / cell-5` ramps to 80°C in about 11 seconds.
Refresh the telemetry and ask the agent again. Both should identify the same
cell, using their actual query results. The event expires automatically.

Reset it early with:

```sh
python3 simulate.py reset
```

## Use an MCP Apps host

The included browser host uses the official MCP Apps `AppBridge` and App SDK.
To use a compatible agent client instead, register two stdio servers:

- `node /absolute/path/to/examples/bess-mcp-app/server.mjs`: the App adapter,
  exposing `open_bess`, `read_bess_snapshot`, and `ui://influxdb3/bess.html`.
- `node /absolute/path/to/examples/bess-mcp-app/mcp-server.mjs`: the readonly
  InfluxDB 3 tools the agent uses to investigate.

The App uses the standard `sendMessage` method when the host advertises text
messaging. That host controls the next agent turn. If messaging is unavailable,
the App disables the agent action; it does not substitute a scripted query.

## Verify and inspect evidence

With the simulator running:

```sh
npm run verify
```

This checks the readonly tool set, a complete snapshot of 768 cells across four
packs, MCP App tool registration, and the self-contained HTML resource. During
the active heating event, add `-- --expect-hot` to verify the target's 80°C reading.

The latest dashboard query and response are saved in
`.runtime/snapshot-last.json`. The browser host saves the latest actual agent
run in `.runtime/agent-last.json`. These files and the credentials are ignored
by Git. Inspect commands, responses, completeness, and timestamps before using
an answer. The verifier checks the tool/data path; it is not a graded agent eval.

## BESS reference architecture

The signal generators in `simulator/` come from
[influxdata/influxdb3-ref-bess](https://github.com/influxdata/influxdb3-ref-bess/tree/b923d45/simulator).
Their Apache-2.0 license is included in that directory. The reference project
also contains a full BESS dashboard and Processing Engine examples. This
example intentionally uses the smaller live view embedded in the MCP App.
