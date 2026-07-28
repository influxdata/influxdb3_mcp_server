/**
 * Packaging — patch item P7.
 *
 * `zod` is imported at runtime by `src/tools/index.ts` and by every
 * `src/tools/categories/*.tools.ts`, but is declared in `devDependencies`. A
 * clean `npm i --omit=dev` — or any consumer installing the published package
 * — gets a server that cannot start.
 *
 * The check is written as an invariant over every runtime import rather than as
 * a check on `zod` specifically, so it keeps working after P7 lands and catches
 * the next occurrence.
 */

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

/** `@scope/name/sub/path.js` → `@scope/name`; `name/sub` → `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Every bare package `src/` imports, excluding builtins and relative paths. */
function runtimeImports(): Map<string, string[]> {
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

      const name = packageNameOf(specifier);
      const files = byPackage.get(name) ?? [];
      files.push(file.slice(ROOT.length + 1));
      byPackage.set(name, files);
    }
  }

  return byPackage;
}

describe("runtime imports are declared as dependencies", () => {
  const imports = runtimeImports();

  it("finds the packages src/ imports at all (guards the scanner itself)", () => {
    expect([...imports.keys()].sort()).toContain("@modelcontextprotocol/sdk");
    expect([...imports.keys()]).toContain("zod");
  });

  it("every runtime import except zod is declared in dependencies", () => {
    // Current state. When P7 moves zod, this test fails and should be replaced
    // by the [P7] assertion below.
    const missing = [...imports.keys()].filter((n) => !declaredRuntime.has(n));

    expect(missing).toEqual(["zod"]);
  });

  it("zod is imported at runtime but declared only in devDependencies", () => {
    const zodImporters = imports.get("zod") ?? [];

    expect(zodImporters.length).toBeGreaterThan(0);
    expect(zodImporters).toContain("src/tools/index.ts");
    expect(declaredDev.has("zod")).toBe(true);
    expect(declaredRuntime.has("zod")).toBe(false);
  });

  it("the published package ships build/, so the import survives to consumers", () => {
    // Not a hypothetical: `files` includes `build`, and the compiled output
    // keeps the bare `zod` specifier. The failure lands on the consumer.
    expect(pkg.files).toContain("build");
    expect(pkg.main).toBe("./build/index.js");
  });
});

describe.skip("[P7] zod is a runtime dependency", () => {
  // Un-skip when P7 lands, and delete the two characterization tests above
  // that assert the opposite.
  const imports = runtimeImports();

  it("no runtime import is missing from dependencies", () => {
    const missing = [...imports.keys()].filter((n) => !declaredRuntime.has(n));

    expect(missing).toEqual([]);
  });

  it("zod is not left duplicated in devDependencies", () => {
    expect(declaredRuntime.has("zod")).toBe(true);
    expect(declaredDev.has("zod")).toBe(false);
  });
});
