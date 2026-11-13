import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-claim-policy.js");

function check(root: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CLAIM_POLICY_ROOT: root },
    encoding: "utf8",
  });
}

function checkFiles(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "claim-policy-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), value);
    }
    spawnSync("git", ["add", "."], { cwd: dir });
    return check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scripts/check-claim-policy.js", () => {
  it("passes on this repository", () => {
    const result = check(ROOT);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("allows claim IDs in maintainer records", () => {
    const result = checkFiles({
      "src/tools/a.ts": 'description: "Core 3.12.1 returns 500."\n',
      "CHANGELOG.md": "Verified by claim-20261015-0107.\n",
      "docs/adr/0001.md": "See claim-20261015-0108.\n",
    });
    expect(result.status).toBe(0);
  });

  it.each([
    "src/tools/a.ts",
    "src/prompts/p.ts",
    "context/database-context.md",
    "README.md",
    "docs/read-only-output-contract.md",
  ])("rejects a claim ID in runtime text: %s", (path) => {
    const result = checkFiles({ [path]: "ok\nSee claim-20261015-0107.\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${path}:2: claim ID in runtime text`);
  });

  it.each(["src/tools/a.ts", "CHANGELOG.md", "docs/adr/0001.md"])(
    "rejects a research path anywhere: %s",
    (path) => {
      const result = checkFiles({
        [path]: "research/claims/2026-10-15-run/claims.yml\n",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${path}:1: docs-tooling research path`);
    },
  );
});
