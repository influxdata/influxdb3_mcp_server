/**
 * Packaging — every runtime import must be a declared dependency.
 *
 * `zod` is imported at runtime by `src/tools/index.ts` and by every
 * `src/tools/categories/*.tools.ts`. It used to be declared only in
 * `devDependencies`, so a clean `npm i --omit=dev` — or any consumer
 * installing the published package — got a server that couldn't start.
 *
 * The check is written as an invariant over every runtime import rather than
 * as a check on `zod` specifically, so it catches the next occurrence too.
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

  it("the published package ships build/, so a missing dependency reaches consumers", () => {
    // Not a hypothetical: `files` includes `build`, and the compiled output
    // keeps every bare specifier. A misdeclared package lands on the consumer.
    expect(pkg.files).toContain("build");
    expect(pkg.main).toBe("./build/index.js");
  });
});

describe("zod is a runtime dependency", () => {
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
