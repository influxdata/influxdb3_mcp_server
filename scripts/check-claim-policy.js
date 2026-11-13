// Enforce where claim IDs and ledger paths may appear in tracked files.
//
// Runtime text is what an operator's agent reads: tool descriptions, prompts,
// resources, schemas, and the docs shipped in the package. It states a fact
// with its edition and version and never carries a claim ID. Maintainer
// records (CHANGELOG, docs/adr, e2e results) may cite IDs. No tracked file may
// name a path inside docs-tooling's research tree.
//
//   node scripts/check-claim-policy.js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLAIM_ID = /claim-\d{8}-\d{4}/;
const RESEARCH_PATH =
  /\bresearch\/(?:claims|work|reports|handoffs|playbooks)\b/;
const RUNTIME = [
  /^src\//,
  /^context\//,
  /^schemas\//,
  /^README\.md$/,
  /^server\.json$/,
  /^docs\/read-only-output-contract\.md$/,
];
const SELF = new Set([
  "scripts/check-claim-policy.js",
  "tests/claim-policy.test.ts",
]);

const root = process.env.CLAIM_POLICY_ROOT
  ? resolve(process.env.CLAIM_POLICY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("git", ["ls-files", "-z", "--cached"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .split("\0")
  .filter((path) => path && !SELF.has(path));

const failures = [];
for (const file of files) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (text.includes("\0")) continue;
  const runtime = RUNTIME.some((pattern) => pattern.test(file));
  text.split("\n").forEach((line, i) => {
    if (runtime && CLAIM_ID.test(line)) {
      failures.push(`${file}:${i + 1}: claim ID in runtime text`);
    }
    if (RESEARCH_PATH.test(line)) {
      failures.push(`${file}:${i + 1}: docs-tooling research path`);
    }
  });
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(
    "\nRuntime text states facts with edition and version, with no claim IDs. Cite IDs only in CHANGELOG, docs/adr, or e2e results. Never name research/ paths.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Claim policy: no claim IDs in runtime text and no research paths in tracked files.",
  );
}
