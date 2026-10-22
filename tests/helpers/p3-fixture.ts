import { appendFileSync } from "node:fs";
import { URL } from "node:url";
import { z } from "zod";

/** Isolated 3.12.1 catalog fixture. Never writes to the shared seed databases. */
export async function createP3Fixture(mode: "implicit" | "explicit") {
  const url = process.env.INFLUX_DB_INSTANCE_URL;
  const admin = process.env.INFLUX_DB_TOKEN;
  const product = process.env.INFLUX_DB_PRODUCT_TYPE;
  if (!url || !admin || !["core", "enterprise"].includes(product ?? "")) {
    throw new Error("P3 needs a Core/Enterprise URL, product, and admin token");
  }
  const db = `mcp_p3_${mode}_${process.pid}_${Date.now()}`;
  const tokenName = `${db}_app`;
  let databaseCreated = false;
  let tokenCreated = false;
  const secrets = new Set([admin]);

  async function request(
    method: string,
    path: string,
    body?: unknown,
    token = admin,
    capture = true,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, url), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const output = process.env.INFLUX_TEST_P3_OBSERVATIONS;
    if (capture && output) {
      appendFileSync(
        output,
        JSON.stringify({
          product,
          mode,
          db,
          method,
          path,
          request: body,
          status: response.status,
          body: [...secrets].reduce(
            (value, secret) => value.split(secret).join("[REDACTED]"),
            text,
          ),
        }) + "\n",
      );
    }
    if (!response.ok) {
      // Token endpoint bodies contain credentials. Do not include them in errors.
      throw new Error(`P3 ${method} ${path}: HTTP ${response.status}`);
    }
    return text ? JSON.parse(text) : undefined;
  }

  async function close() {
    try {
      if (tokenCreated) {
        await request(
          "DELETE",
          `/api/v3/configure/token?token_name=${tokenName}`,
          undefined,
          admin,
          false,
        );
      }
    } finally {
      if (databaseCreated) {
        await request(
          "DELETE",
          `/api/v3/configure/database?db=${db}&hard_delete_at=now`,
        );
      }
    }
  }

  const query = (
    q: string,
    database = db,
    token = admin,
    params?: Record<string, string>,
  ) =>
    request(
      "POST",
      "/api/v3/query_sql",
      { db: database, q, format: "json", ...(params && { params }) },
      token,
    );

  try {
    const ping = await request("GET", "/ping");
    const version = z
      .object({ version: z.string().min(1), revision: z.string() })
      .safeParse(ping);
    if (!version.success)
      throw new Error("P3 could not identify the testbench version");
    await request("POST", "/api/v3/configure/database", {
      db,
      schema_mode: mode,
    });
    databaseCreated = true;
    const minted =
      product === "core"
        ? await request(
            "POST",
            "/api/v3/configure/token/named_admin",
            { token_name: tokenName, expiry_secs: 3600 },
            admin,
            false,
          )
        : await request(
            "POST",
            "/api/v3/enterprise/configure/token",
            {
              type: "resource",
              token_name: tokenName,
              expiry_secs: 3600,
              permissions: [
                {
                  resource_type: "db",
                  resource_names: [db],
                  actions: ["read", "write"],
                },
              ],
            },
            admin,
            false,
          );
    tokenCreated = true;
    const parsed = z.object({ token: z.string().min(1) }).safeParse(minted);
    if (!parsed.success) throw new Error("P3 app token response has no token");
    const app = parsed.data.token;
    secrets.add(app);
    for (const table of ["active", "retired", "metrics-20260101T000000"]) {
      await request("POST", "/api/v3/configure/table", {
        db,
        table,
        tags: ["host"],
        fields: [
          { name: "value", type: "float64" },
          { name: "note", type: "utf8" },
          { name: "flag", type: "bool" },
          { name: "count", type: "int64" },
          { name: "unsigned_count", type: "uint64" },
        ],
      });
      const written = await fetch(new URL(`/api/v3/write_lp?db=${db}`, url), {
        method: "POST",
        headers: { Authorization: `Bearer ${app}` },
        body: `${table},host=a value=1.5,note="hello",flag=true,count=2i,unsigned_count=3u`,
      });
      if (!written.ok)
        throw new Error(`P3 fixture write: HTTP ${written.status}`);
    }
    await request(
      "DELETE",
      `/api/v3/configure/table?db=${db}&table=retired&hard_delete_at=2099-01-01T00:00:00Z`,
    );
    const catalog = await query(
      "SELECT table_name, deleted FROM system.tables WHERE database_name = $db",
      "_internal",
      admin,
      { db },
    );
    const tables = z
      .array(z.object({ table_name: z.string(), deleted: z.boolean() }))
      .parse(catalog);
    const tombstone = tables.find((table) => table.deleted)?.table_name;
    if (!tombstone) throw new Error("P3 fixture has no soft-deleted table");
    await query(
      "SELECT * FROM system.influxdb_schema ORDER BY measurement, key",
    );
    await query(
      "SELECT database_name, schema_mode FROM system.databases WHERE database_name = $db",
      "_internal",
      admin,
      { db },
    );
    return {
      db,
      mode,
      product,
      tombstone,
      close,
      query,
      adminEnv: {
        INFLUX_DB_INSTANCE_URL: url,
        INFLUX_DB_TOKEN: admin,
        INFLUX_DB_PRODUCT_TYPE: product ?? "core",
        INFLUX_MCP_TOOL_PROFILE: "readonly",
      },
      appEnv: {
        INFLUX_DB_INSTANCE_URL: url,
        INFLUX_DB_TOKEN: app,
        INFLUX_DB_PRODUCT_TYPE: product ?? "core",
        INFLUX_MCP_TOOL_PROFILE: "readonly",
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
