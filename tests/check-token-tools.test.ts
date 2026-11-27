import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { Scenario } from "./fixtures/influxdb-scenarios.js";
import { startFakeInfluxDB, FakeInfluxDB } from "./helpers/fake-influxdb.js";

const run = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, "../scripts/check-token-tools.mjs");
const CONFIGURED_TOKEN = "apiv3_configured_admin_token_value_0000";
const CREATED_TOKEN = "apiv3_created_token_value_1111";

const sourceInspection = (detail: string) => ({
  products: ["enterprise" as const],
  version: "3.12.3",
  source: "source-inspection" as const,
  detail,
});

const TOKEN_ENDPOINTS: Scenario[] = [
  {
    name: "list tokens from system.tokens",
    provenance: sourceInspection("token-management.service.ts list queries"),
    request: { method: "POST", path: "/api/v3/query_sql" },
    response: { status: 200, body: [] },
  },
  {
    name: "create a resource token",
    provenance: sourceInspection("createResourceToken on Enterprise"),
    request: { method: "POST", path: "/api/v3/enterprise/configure/token" },
    response: { status: 201, body: { id: 7, token: CREATED_TOKEN } },
  },
  {
    name: "create a named admin token",
    provenance: sourceInspection("createAdminToken"),
    request: { method: "POST", path: "/api/v3/configure/token/named_admin" },
    response: { status: 201, body: { id: 8, token: CREATED_TOKEN } },
  },
  {
    name: "delete a token",
    provenance: sourceInspection("deleteToken"),
    request: { method: "DELETE", path: "/api/v3/configure/token" },
    response: { status: 200, body: "" },
  },
];

let fake: FakeInfluxDB | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("scripts/check-token-tools.mjs", () => {
  it("creates, deletes, and lists tokens without saving any token value", async () => {
    fake = await startFakeInfluxDB(TOKEN_ENDPOINTS);
    const outFile = join(mkdtempSync(join(tmpdir(), "token-tools-")), "r.json");

    const { stdout } = await run(process.execPath, [SCRIPT, outFile], {
      env: {
        PATH: process.env.PATH ?? "",
        INFLUX_DB_INSTANCE_URL: fake.url,
        INFLUX_DB_TOKEN: CONFIGURED_TOKEN,
        INFLUX_TEST_DATABASE: "metrics",
      },
    });

    const report = readFileSync(outFile, "utf8");
    for (const secret of [CONFIGURED_TOKEN, CREATED_TOKEN]) {
      expect(stdout).not.toContain(secret);
      expect(report).not.toContain(secret);
    }

    const calls = fake.requests.map((r) => `${r.method} ${r.path}`);
    expect(calls).toEqual([
      "POST /api/v3/query_sql",
      "POST /api/v3/query_sql",
      "POST /api/v3/enterprise/configure/token",
      "POST /api/v3/configure/token/named_admin",
      "DELETE /api/v3/configure/token",
      "DELETE /api/v3/configure/token",
      "POST /api/v3/query_sql",
      "POST /api/v3/query_sql",
    ]);
    expect(calls.some((c) => c.includes("regenerate"))).toBe(false);
    expect(fake.requests[2].body).toMatchObject({
      permissions: [
        { resource_type: "db", resource_names: ["metrics"], actions: ["read"] },
      ],
      expiry_secs: 3600,
    });

    const { results } = JSON.parse(report);
    expect(results.every((r: { isError: boolean }) => !r.isError)).toBe(true);
  });

  it("refuses to run without credentials", async () => {
    await expect(
      run(process.execPath, [SCRIPT], {
        env: { PATH: process.env.PATH ?? "" },
      }),
    ).rejects.toMatchObject({ code: 2 });
  });
});
