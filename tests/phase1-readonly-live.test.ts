import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

const PRODUCT_TYPE = process.env.INFLUX_DB_PRODUCT_TYPE ?? "core";
const DB_NAME = `mcp_phase1_${PRODUCT_TYPE}`;
const TABLE_NAME = "sensor_readings";

function textContent(result: any): string {
  return (result.content as Array<{ type: string; text: string }>)[0]?.text;
}

function jsonContent<T = any>(result: any): T {
  return JSON.parse(textContent(result)) as T;
}

describe.skipIf(!RUN)("Phase 1 read-only live tools", () => {
  let adminClient: TestClient;
  let readonlyClient: TestClient;

  beforeAll(async () => {
    const env: Record<string, string> = {
      INFLUX_MCP_TOOL_PROFILE: "operator",
    };
    if (process.env.INFLUX_DB_INSTANCE_URL)
      env.INFLUX_DB_INSTANCE_URL = process.env.INFLUX_DB_INSTANCE_URL;
    if (process.env.INFLUX_DB_TOKEN)
      env.INFLUX_DB_TOKEN = process.env.INFLUX_DB_TOKEN;
    if (process.env.INFLUX_DB_PRODUCT_TYPE)
      env.INFLUX_DB_PRODUCT_TYPE = process.env.INFLUX_DB_PRODUCT_TYPE;

    adminClient = await createTestClient(env);

    await adminClient.client.callTool({
      name: "delete_database",
      arguments: { name: DB_NAME },
    });
    await adminClient.client.callTool({
      name: "create_database",
      arguments: { name: DB_NAME },
    });
    await adminClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: DB_NAME,
        data: `${TABLE_NAME},sensor=a,region=west temp=71.2,humidity=41i 1710000000\n${TABLE_NAME},sensor=b,region=east temp=68.5,humidity=39i 1710000060`,
        precision: "second",
      },
    });

    readonlyClient = await createTestClient({
      ...env,
      INFLUX_MCP_TOOL_PROFILE: "readonly",
    });
  });

  afterAll(async () => {
    await readonlyClient?.close();
    await adminClient?.client.callTool({
      name: "delete_database",
      arguments: { name: DB_NAME },
    });
    await adminClient?.close();
  });

  it("advertises only the read-only Phase 1 tool surface", async () => {
    const result = await readonlyClient.client.listTools();
    const names = result.tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "query_sql",
        "query_influxql",
        "list_tables",
        "describe_table",
        "investigate_database",
      ]),
    );
    expect(names).not.toContain("write_line_protocol");
    expect(names).not.toContain("delete_database");
  });

  it("runs structured read-only SQL and rejects writes", async () => {
    const result = await readonlyClient.client.callTool({
      name: "query_sql",
      arguments: {
        db: DB_NAME,
        q: `SELECT temp, humidity FROM ${TABLE_NAME} WHERE time >= '2024-03-09T16:00:00Z' LIMIT 5`,
      },
    });
    const body = jsonContent(result);

    expect(body.ok).toBe(true);
    expect(body.db).toBe(DB_NAME);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.metadata.query_type).toBe("sql");
    expect(body.metadata.row_count).toBe(body.rows.length);

    const rejected = await readonlyClient.client.callTool({
      name: "query_sql",
      arguments: {
        db: DB_NAME,
        q: `DROP TABLE ${TABLE_NAME}`,
      },
    });
    const error = jsonContent(rejected);

    expect((rejected as { isError?: boolean }).isError).toBe(true);
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe("not_read_only");
  });

  it("runs structured read-only InfluxQL and rejects SELECT INTO", async () => {
    const result = await readonlyClient.client.callTool({
      name: "query_influxql",
      arguments: {
        db: DB_NAME,
        q: `SELECT temp FROM ${TABLE_NAME} LIMIT 5`,
      },
    });
    const body = jsonContent(result);

    expect(body.ok).toBe(true);
    expect(body.metadata.query_type).toBe("influxql");

    const rejected = await readonlyClient.client.callTool({
      name: "query_influxql",
      arguments: {
        db: DB_NAME,
        q: `SELECT temp INTO rollup FROM ${TABLE_NAME}`,
      },
    });
    const error = jsonContent(rejected);

    expect((rejected as { isError?: boolean }).isError).toBe(true);
    expect(error.error.code).toBe("select_into");
  });

  it("discovers tables and returns conservative schema categories", async () => {
    const tablesResult = await readonlyClient.client.callTool({
      name: "list_tables",
      arguments: { db: DB_NAME },
    });
    const tables = jsonContent(tablesResult);

    expect(tables.ok).toBe(true);
    expect(tables.tables).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: TABLE_NAME })]),
    );

    const schemaResult = await readonlyClient.client.callTool({
      name: "describe_table",
      arguments: { db: DB_NAME, table: TABLE_NAME },
    });
    const schema = jsonContent(schemaResult);

    expect(schema.ok).toBe(true);
    expect(schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "time", category: "time" }),
        expect.objectContaining({ name: "temp", category: "unknown" }),
      ]),
    );
  });
});
