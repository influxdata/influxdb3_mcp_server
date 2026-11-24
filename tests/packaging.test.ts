import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isBuiltin } from "node:module";

const ROOT = resolve(import.meta.dirname, "..");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const declaredRuntime = new Set(Object.keys(pkg.dependencies ?? {}));
const declaredDev = new Set(Object.keys(pkg.devDependencies ?? {}));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

function packageNameWithoutSubpath(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function srcFilesByImportedNonBuiltinPackage(): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();

  for (const file of sourceFiles(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      if (isBuiltin(specifier)) continue;

      const name = packageNameWithoutSubpath(specifier);
      const files = byPackage.get(name) ?? [];
      files.push(file.slice(ROOT.length + 1));
      byPackage.set(name, files);
    }
  }

  return byPackage;
}

describe("runtime imports are declared as dependencies", () => {
  const imports = srcFilesByImportedNonBuiltinPackage();

  it("finds the packages src/ imports at all (guards the scanner itself)", () => {
    expect([...imports.keys()].sort()).toContain("@modelcontextprotocol/sdk");
    expect([...imports.keys()]).toContain("zod");
  });

  it("the published package ships build/, so a missing dependency reaches consumers", () => {
    expect(pkg.files).toContain("build");
    expect(pkg.main).toBe("./build/index.js");
  });
});

describe("zod is a runtime dependency, so a server installed with npm i --omit=dev starts", () => {
  const imports = srcFilesByImportedNonBuiltinPackage();

  it("no runtime import is missing from dependencies", () => {
    const missing = [...imports.keys()].filter((n) => !declaredRuntime.has(n));

    expect(missing).toEqual([]);
  });

  it("zod is not left duplicated in devDependencies", () => {
    expect(declaredRuntime.has("zod")).toBe(true);
    expect(declaredDev.has("zod")).toBe(false);
  });
});
