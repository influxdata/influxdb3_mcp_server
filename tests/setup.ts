import { existsSync } from "node:fs";
import { resolve } from "node:path";

const buildPath = resolve(import.meta.dirname, "../build/index.js");
if (!existsSync(buildPath)) {
  throw new Error(
    `build/index.js not found at ${buildPath}. Run \`npm run build\` before running tests.`,
  );
}
