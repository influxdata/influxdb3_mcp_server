#!/usr/bin/env node
/**
 * A local endpoint for the write evals that need a server which never
 * answers a write. Point INFLUX_DB_INSTANCE_URL at the printed URL.
 *
 *   node scripts/fake-write-endpoint.mjs reset   # wr-reset-*: close without a reply
 *   node scripts/fake-write-endpoint.mjs silent  # wr-client-timeout: read, never reply
 *
 * Optional second argument: the port (default 8199).
 */
import net from "node:net";
import process from "node:process";

const BEHAVIOURS = {
  reset: (socket) => socket.once("data", () => socket.resetAndDestroy()),
  silent: (socket) => socket.resume(),
};

const [mode, port = "8199"] = process.argv.slice(2);
const behaviour = BEHAVIOURS[mode];
if (!behaviour) {
  process.stderr.write(
    `Usage: fake-write-endpoint.mjs <${Object.keys(BEHAVIOURS).join("|")}> [port]\n`,
  );
  process.exit(2);
}

net.createServer(behaviour).listen(Number(port), "127.0.0.1", function () {
  const { port: bound } = this.address();
  process.stdout.write(`${mode} endpoint at http://127.0.0.1:${bound}\n`);
});
