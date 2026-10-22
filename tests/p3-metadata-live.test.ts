import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createP3Fixture } from "./helpers/p3-fixture.js";
import {
  callTool,
  createTestClient,
  type TestClient,
} from "./helpers/mcp-client.js";

const live = ["true", "1"].includes(process.env.INFLUX_TEST_ENABLED ?? "");
const product = process.env.INFLUX_DB_PRODUCT_TYPE;
const supported = product === "core" || product === "enterprise";

for (const mode of ["implicit", "explicit"] as const) {
  describe.skipIf(
    !live || !supported || (mode === "explicit" && product !== "enterprise"),
  )(
    `[live-only] P3 isolated ${mode} metadata on ${product ?? "unconfigured product"}`,
    () => {
      let fixture: Awaited<ReturnType<typeof createP3Fixture>>;
      let admin: TestClient;
      let app: TestClient;

      beforeAll(async () => {
        fixture = await createP3Fixture(mode);
        admin = await createTestClient(fixture.adminEnv);
        app = await createTestClient(fixture.appEnv);
      });
      afterAll(async () => {
        try {
          await app?.close();
          await admin?.close();
        } finally {
          await fixture?.close();
        }
      });

      it("reports authoritative roles, schema mode, and active-table deletion evidence", async () => {
        const { body } = await callTool(admin, "describe_table", {
          db: fixture.db,
          table: "active",
        });
        expect(body.ok).toBe(true);
        expect(body.schema_mode).toEqual({
          value: mode,
          source: "server",
          catalog: "system.databases",
        });
        expect(body.deletion).toEqual({
          value: false,
          source: "server",
          catalog: "system.tables",
        });
        for (const [name, category] of [
          ["host", "tag"],
          ["time", "time"],
          ["note", "field"],
          ["value", "field"],
          ["count", "field"],
          ["unsigned_count", "field"],
          ["flag", "field"],
        ]) {
          expect(body.columns).toContainEqual(
            expect.objectContaining({ name, category, source: "server" }),
          );
        }
      });

      it("keeps tombstones and similarly named active tables without losing successful samples", async () => {
        const { body } = await callTool(admin, "investigate_database", {
          db: fixture.db,
          includeSamples: true,
          maxTables: 3,
        });
        expect(body.ok).toBe(true);
        expect(body.table_count).toBe(3);
        const tables = z
          .array(
            z.object({
              name: z.string(),
              status: z.string(),
              deletion: z.unknown(),
              schema_mode: z.unknown(),
              samples: z.array(z.unknown()).optional(),
            }),
          )
          .parse(body.tables);
        const byName = new Map(tables.map((table) => [table.name, table]));
        expect(byName.get("active")).toMatchObject({
          status: "ok",
          deletion: {
            value: false,
            source: "server",
            catalog: "system.tables",
          },
          schema_mode: {
            value: mode,
            source: "server",
            catalog: "system.databases",
          },
        });
        expect(byName.get("active")?.samples).toHaveLength(1);
        expect(byName.get(fixture.tombstone)).toMatchObject({
          deletion: { value: true, source: "server", catalog: "system.tables" },
        });
        expect(byName.get("metrics-20260101T000000")).toMatchObject({
          deletion: {
            value: false,
            source: "server",
            catalog: "system.tables",
          },
        });
        expect(body.query_budget.used).toBeLessThanOrEqual(
          body.query_budget.max,
        );
      });

      it.skipIf(product !== "enterprise")(
        "keeps scoped reads and column roles when the internal catalog is denied",
        async () => {
          await expect(
            fixture.query(
              "SELECT table_name FROM system.tables WHERE database_name = $db",
              "_internal",
              fixture.appEnv.INFLUX_DB_TOKEN,
              { db: fixture.db },
            ),
          ).rejects.toThrow("HTTP 403");
          const { body } = await callTool(app, "describe_table", {
            db: fixture.db,
            table: "active",
          });
          expect(body.ok).toBe(true);
          expect(body.columns).toContainEqual(
            expect.objectContaining({
              name: "host",
              category: "tag",
              source: "server",
            }),
          );
          expect(body.schema_mode).toEqual({
            value: "unknown",
            source: "unknown",
          });
          expect(body.deletion).toEqual({
            value: "unknown",
            source: "unknown",
          });
          const investigation = await callTool(app, "investigate_database", {
            db: fixture.db,
            includeSamples: false,
            maxTables: 3,
          });
          expect(investigation.body.tables).toHaveLength(3);
          expect(investigation.body.tables_failed).toBe(0);
          expect(investigation.body.tables).toContainEqual(
            expect.objectContaining({
              name: fixture.tombstone,
              deletion: { value: "unknown", source: "unknown" },
            }),
          );
          expect(investigation.body.warnings).toContainEqual(
            expect.objectContaining({ code: "possibly_deleted" }),
          );
        },
      );
    },
  );
}
