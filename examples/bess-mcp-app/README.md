# BESS MCP App example

Investigate live battery-energy-storage-system data with your own MCP Apps
client, such as Claude Desktop or ChatGPT. No Codex CLI, model API key, or
bundled agent is required. Your client supplies the agent and runs the investigation.

A local simulator produces four battery packs with 192 cells each. The App shows
fresh readings, lets you trigger and reset a hot cell, and sends an editable
question to your client through the standard MCP Apps `sendMessage` method.
The agent chooses its tools and SQL; its answer and tool calls appear in chat.
The dashboard is a separate, inspectable SQL read, not a scripted investigation.

## Prerequisites

- A checkout of this repository and a Node.js version supported by its `package.json`.
- Python 3.10 or later for the simulator, which uses the standard library.
- An existing InfluxDB 3 Enterprise or InfluxDB 3 Cloud database. Use product
  `enterprise` for InfluxDB 3 Cloud.
- Separate database credentials: read/write for the simulator, read-only for the
  App and agent. The simulator needs read access for its startup database check.
- An MCP Apps client that can render App resources and call tools. Sending a
  prompt from the App also requires the host's text-messaging capability.

The `readonly` profile limits the database tools exposed to the agent. The
read token enforces database access separately. The full InfluxDB 3 MCP server
also supports write and administration tools. Core can run this example with
an operator token, but does not provide the same database-enforced read-only boundary.

The App's simulator controls are separate app-only tools. They update a local
scenario file; only the independently running simulator reads the writer token
and writes telemetry. Tool visibility is a client UI contract, not an authorization
boundary against arbitrary MCP callers.

## Configure and feed the example

From the repository root:

```sh
pnpm install
pnpm run build
cd examples/bess-mcp-app
npm ci
npm run build
cp connection.example.json connection.json
mkdir -p .secrets
chmod 700 .secrets
```

Edit `connection.json` with your host, existing database name, and product
(`enterprise` or `core`). Local connection details are ignored by Git.

Save `.secrets/read.json` and `.secrets/write.json`, each with this shape:

```json
{ "token": "<YOUR_TOKEN>" }
```

```sh
chmod 600 .secrets/read.json .secrets/write.json
python3 simulate.py run
```

Keep the simulator running. It checks the database before writing and produces
773 readings about once per second: 768 cells, four packs, and one inverter.
Stop with Ctrl+C, or add `--duration 300` for five minutes. Implicit schemas
create the telemetry tables on first write. For explicit schemas, create
compatible tables first.

`INFLUXDB_READ_TOKEN_FILE` and `INFLUXDB_WRITE_TOKEN_FILE` can point to existing
JSON credential files instead. The MCP process reads only the reader file;
the simulator alone reads the writer file. Credentials never go to the browser
or into agent prompts.

## Connect Claude Desktop locally

Register **one** local stdio server in Claude Desktop's MCP configuration,
replacing the absolute paths:

```json
{
  "mcpServers": {
    "bess": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/influxdb3_mcp_server/examples/bess-mcp-app/stdio.mjs"
      ]
    }
  }
}
```

Use `command -v node` to find the executable. Configuration resolves relative
to the example's files, so the client does not need a special working directory.
Follow [Claude's local MCP setup instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
to reload the connection. Enable the server's tools, then ask:

> Open the BESS App with open_bess.

The same connection exposes the visual App and all readonly database tools.
Other clients with local stdio and MCP Apps support can use this entry point too.

## Connect ChatGPT or another remote client

The included HTTP host exposes the same server at `/mcp` using stateless
Streamable HTTP. Start it in another terminal:

```sh
npm start
```

It listens on `127.0.0.1:8091` by default. Set `PORT` if necessary.
Remote clients need an HTTPS route to that host; they cannot reach your laptop's
loopback address directly. For a temporary development connection, use a tunnel,
for example `ngrok http 8091`, then restart the host with its HTTPS origin:

```sh
BESS_PUBLIC_URL=https://YOUR-TUNNEL-HOST npm start
```

In ChatGPT developer mode, add the MCP connection with URL
`https://YOUR-TUNNEL-HOST/mcp`, choosing no authentication for this disposable
example. Follow the current [ChatGPT connection instructions](https://developers.openai.com/plugins/build/app-quickstart).
Select the connection in chat and ask it to open BESS.

**The example HTTP endpoint has no authentication.** Only tunnel a disposable
BESS database containing simulated data. Anyone who can reach the endpoint can
query the databases visible to its reader token and change the simulator scenario.
Use a database-scoped read token. Stop the tunnel when finished. Hosting a shared
service with real data requires authentication and deployment work beyond this example.

`BESS_PUBLIC_URL` allows the tunnel's Host and Origin headers. The server rejects
other hosts and cross-origin browser requests. The browser-preview routes remain
local-only. A secure private tunnel is another option when supported by your client.

## Try the full flow in your agent client

1. Open the BESS App in chat and inspect the normal readings.
2. Click **Trigger hot cell**. The cell `pack-0 / mod-3 / cell-5` ramps to 80°C;
   telemetry refreshes after 12 seconds. The event lasts ten minutes.
3. Click **Ask agent** with the suggested question or edit it first. Your client
   receives the prompt and controls the next agent turn. Read the answer and
   actual tool calls in chat. The agent should inspect schemas, query fresh data,
   and report evidence and completeness.
4. Click **Reset scenario**, then ask again to compare the fresh result.

The App does not run a model itself or fabricate an answer. Hosts that do not
advertise messaging disable **Ask agent** and explain how to use the prompt in
chat instead. Clients may require approval before running tools or continuing a turn.

The telemetry and 70°C threshold are for demonstration, not physical battery
assessment. No caches or Processing Engine plugins are required.

### Browser preview

With `npm start` running, open <http://127.0.0.1:8091/>. This preview renders the
same App, including live data and scenario buttons. It has no agent, so **Ask
agent** is disabled. Use your connected MCP Apps client for the full flow.

### Terminal scenario controls

These remain available if a client cannot render the App:

```sh
python3 simulate.py heat --duration 180
python3 simulate.py reset
```

## Verify and inspect evidence

With the simulator running:

```sh
npm run verify
```

To also verify a running HTTP endpoint:

```sh
npm run verify -- --http http://127.0.0.1:8091/mcp
```

These checks cover the readonly database tools, a complete 768-cell snapshot,
App registration and HTML, scenario tool visibility, and a live database query
through the combined server. Add `--expect-hot` during an active heating event
to verify the target's 80°C reading. They do not grade a model or establish that
a particular client's UI and agent behavior work end to end. Test those in your
chosen client using the flow above.

The latest dashboard SQL and response are saved in `.runtime/snapshot-last.json`.
Use your client's conversation and tool-call history for agent evidence. There is
no separate agent process or agent-run log in this example. Credentials, scenario
state, generated bundles, and other runtime files are ignored by Git.

## BESS reference architecture

The signal generators in `simulator/` come from
[influxdata/influxdb3-ref-bess](https://github.com/influxdata/influxdb3-ref-bess/tree/b923d45/simulator).
Their Apache-2.0 license is included in that directory. The reference project
also contains a full BESS dashboard and Processing Engine examples. This example
uses the smaller live view embedded in the MCP App.
