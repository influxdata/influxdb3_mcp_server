import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function changelog(withUnreleased: boolean): string {
  return [
    "# Changelog",
    "",
    ...(withUnreleased
      ? ["## [Unreleased]", "", "### Added", "", "- x", ""]
      : []),
    `## [${pkg.version}] - 2026-01-01`,
    "",
    "### Fixed",
    "",
    "- y",
    "",
  ].join("\n");
}

function runCheck(withUnreleased: boolean, tag?: string) {
  const dir = mkdtempSync(join(tmpdir(), "check-versions-"));
  try {
    const path = join(dir, "CHANGELOG.md");
    writeFileSync(path, changelog(withUnreleased));
    const env: Record<string, string | undefined> = {
      ...process.env,
      CHANGELOG_PATH: path,
    };
    delete env.TAG_NAME;
    if (tag) env.TAG_NAME = tag;
    return spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "check-versions.js")],
      { env, encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scripts/check-versions.js with an [Unreleased] changelog section", () => {
  it("passes with an Unreleased section and no TAG_NAME", () => {
    expect(runCheck(true).status).toBe(0);
  });
  it("fails with an Unreleased section and TAG_NAME", () => {
    const result = runCheck(true, `v${pkg.version}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("[Unreleased]");
  });
  it("passes with no Unreleased section and TAG_NAME", () => {
    expect(runCheck(false, `v${pkg.version}`).status).toBe(0);
  });
});
