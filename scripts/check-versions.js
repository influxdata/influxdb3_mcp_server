import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const server = JSON.parse(read("server.json"));

const changelog = process.env.CHANGELOG_PATH
  ? readFileSync(resolve(process.env.CHANGELOG_PATH), "utf8")
  : read("CHANGELOG.md");
const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
const latestReleasedVersion = headings.find((h) => h !== "Unreleased");

const versions = {
  "config.ts": read("src/config.ts").match(/version: "([^"]+)"/)?.[1],
  "CHANGELOG.md": latestReleasedVersion,
  "server.json": server.version,
};

assert.ok(pkg.mcpName, "package.json must declare mcpName");
assert.equal(server.name, pkg.mcpName, "server.json name must match mcpName");

const npmPackages = server.packages.filter((p) => p.registryType === "npm");
assert.equal(npmPackages.length, 1, "server.json must contain one npm package");
assert.equal(
  npmPackages[0].identifier,
  pkg.name,
  "server.json npm identifier must match package.json name",
);
versions["server.json npm package"] = npmPackages[0].version;

console.log(`package.json: ${pkg.version}`);
for (const [file, version] of Object.entries(versions)) {
  console.log(`${file}: ${version}`);
  assert.equal(version, pkg.version, `${file} must match package.json version`);
}

if (process.env.TAG_NAME) {
  assert.ok(
    !headings.includes("Unreleased"),
    "CHANGELOG.md must not have an [Unreleased] section in a release; move it into a numbered section",
  );
  assert.equal(
    process.env.TAG_NAME,
    `v${pkg.version}`,
    "Release tag must match package.json version",
  );
}
console.log(`All versions match: ${pkg.version}`);
