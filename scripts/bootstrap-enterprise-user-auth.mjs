#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_HOST = "http://127.0.0.1:8181";
const DEFAULT_CONTAINER = "influxdb3-enterprise";

function usage() {
  console.log(`Bootstrap experimental InfluxDB 3 Enterprise user auth for dev/test.

This helper wraps:
  influxdb3 manage init-admin

It is intentionally external to the MCP server. It creates the initial admin
user for a dev Enterprise instance; it does not add an MCP tool or manage
users/roles at runtime.

Usage:
  node scripts/bootstrap-enterprise-user-auth.mjs --username admin [options]

Options:
  --username <name>           Required initial admin username.
  --host <url>                InfluxDB host URL. Default: ${DEFAULT_HOST}
  --display-name <name>       Optional display name.
  --oauth-id <id>             Optional OAuth identity ID.
  --container <name>          Run influxdb3 inside a Docker container.
                              Use --container without a value for ${DEFAULT_CONTAINER}.
  --bin <path>                Local influxdb3 binary. Default: influxdb3.
  --password-env <name>       Env var containing the password. Default: INFLUX_DB_PASSWORD.
                              If unset, the CLI prompts for the password.
  --verify                    After bootstrap, verify login with POST /api/v3/authorize.
                              Requires the password env var to be set.
  --tls-no-verify             Pass through to the CLI.
  --help                      Show this help.

Examples:
  INFLUX_DB_PASSWORD='dev-password' \\
    node scripts/bootstrap-enterprise-user-auth.mjs \\
      --container --username admin --verify

  node scripts/bootstrap-enterprise-user-auth.mjs \\
    --bin /usr/local/bin/influxdb3 --host http://127.0.0.1:8181 --username admin
`);
}

function parseArgs(argv) {
  const args = {
    bin: "influxdb3",
    container: null,
    displayName: null,
    help: false,
    host: DEFAULT_HOST,
    oauthId: null,
    passwordEnv: "INFLUX_DB_PASSWORD",
    tlsNoVerify: false,
    username: null,
    verify: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--username") {
      args.username = requireValue(argv, ++i, arg);
    } else if (arg === "--host" || arg === "-H") {
      args.host = requireValue(argv, ++i, arg);
    } else if (arg === "--display-name") {
      args.displayName = requireValue(argv, ++i, arg);
    } else if (arg === "--oauth-id") {
      args.oauthId = requireValue(argv, ++i, arg);
    } else if (arg === "--bin") {
      args.bin = requireValue(argv, ++i, arg);
    } else if (arg === "--password-env") {
      args.passwordEnv = requireValue(argv, ++i, arg);
    } else if (arg === "--container") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.container = next;
        i++;
      } else {
        args.container = DEFAULT_CONTAINER;
      }
    } else if (arg === "--verify") {
      args.verify = true;
    } else if (arg === "--tls-no-verify") {
      args.tlsNoVerify = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function buildCommand(args, password) {
  const cliArgs = ["manage", "init-admin", "--host", args.host];
  cliArgs.push("--username", args.username);
  if (args.displayName) cliArgs.push("--display-name", args.displayName);
  if (args.oauthId) cliArgs.push("--oauth-id", args.oauthId);
  if (args.tlsNoVerify) cliArgs.push("--tls-no-verify");
  if (password) cliArgs.push("--password", password);

  if (args.container) {
    return {
      command: "docker",
      args: ["exec", "-i", args.container, args.bin, ...cliArgs],
    };
  }

  return { command: args.bin, args: cliArgs };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            signal
              ? `${command} exited from signal ${signal}`
              : `${command} exited with status ${code}`,
          ),
        );
      }
    });
  });
}

async function verifyLogin(host, username, password) {
  const response = await fetch(`${host.replace(/\/$/, "")}/api/v3/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Login verification failed with HTTP ${response.status}: ${text.slice(
        0,
        200,
      )}`,
    );
  }

  const body = await response.json();
  if (!body?.token || !body?.refreshToken) {
    throw new Error("Login verification response did not include token fields");
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("Run with --help for usage.");
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    usage();
    return;
  }

  if (!args.username) {
    console.error("--username is required");
    console.error("Run with --help for usage.");
    process.exitCode = 2;
    return;
  }

  const password = process.env[args.passwordEnv] || "";
  if (args.verify && !password) {
    console.error(
      `--verify requires ${args.passwordEnv} to be set so the helper can test login.`,
    );
    process.exitCode = 2;
    return;
  }

  if (password) {
    console.error(
      `Using password from ${args.passwordEnv}; the value will not be printed.`,
    );
  } else {
    console.error(
      "No password env var set; relying on the CLI password prompt.",
    );
  }

  const { command, args: commandArgs } = buildCommand(args, password);
  console.error(
    `Running init-admin via ${
      args.container ? `container ${args.container}` : command
    } for ${args.host}`,
  );
  await run(command, commandArgs);

  if (args.verify) {
    await verifyLogin(args.host, args.username, password);
    console.error("Verified login with /api/v3/authorize.");
  }

  console.error("Enterprise user-auth bootstrap complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
