import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of [
  "INFLUX_DB_INSTANCE_URL",
  "INFLUX_DB_TOKEN",
  "INFLUX_DB_PRODUCT_TYPE",
])
  assert.ok(process.env[name], `${name} is required`);
assert.ok(
  process.env.INFLUX_DOCKER_INSTANCE_URL,
  "INFLUX_DOCKER_INSTANCE_URL must identify the database from inside Docker",
);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
const directory = mkdtempSync(join(tmpdir(), "mcp-artifacts-"));
try {
  run("pnpm", ["run", "build"]);
  const packed = JSON.parse(
    run("pnpm", ["pack", "--json", "--pack-destination", directory], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const tarball = resolve(directory, packed.filename);
  const installation = join(directory, "installed");
  mkdirSync(installation);
  writeFileSync(
    join(installation, "package.json"),
    JSON.stringify({ private: true, packageManager: pkg.packageManager }),
  );
  run("pnpm", [
    "--dir",
    installation,
    "add",
    "--prod",
    "--ignore-scripts",
    tarball,
  ]);
  const bins = Object.keys(pkg.bin);
  assert.equal(bins.length, 1, "Expected one MCP executable");
  run("pnpm", [
    "run",
    "smoke:server",
    join(installation, "node_modules/.bin", bins[0]),
  ]);
  const image = `${pkg.name.split("/").at(-1)}:verification-${pkg.version}`;
  run("docker", ["build", "--tag", image, "."]);
  run("pnpm", ["run", "smoke:server", "--docker", image], {
    env: {
      ...process.env,
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DOCKER_INSTANCE_URL,
    },
  });
  console.log(
    JSON.stringify(
      {
        version: pkg.version,
        npm_integrity: `sha512-${createHash("sha512")
          .update(readFileSync(tarball))
          .digest("base64")}`,
        image,
        image_id: run(
          "docker",
          ["image", "inspect", image, "--format", "{{.Id}}"],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
          },
        ).trim(),
        checks: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
