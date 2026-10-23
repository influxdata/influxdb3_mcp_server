/**
 * Scripted InfluxDB HTTP responses for the fake server in
 * `tests/helpers/fake-influxdb.ts`.
 *
 * Each scenario records which products and version it stands for and where
 * its response came from. A `source-inspection` scenario is a guess until a
 * live run confirms it. When a live run disagrees, update the scenario from
 * the observed response and change its provenance to that run.
 */

export interface ScenarioProvenance {
  /** The products it stands for; the contract test checks each one's spec. */
  products: Array<"core" | "enterprise">;
  version: string;
  source: "live" | "claim" | "source-inspection";
  /** Live: date, version and testbench target. Claim: the claim ID. Source inspection: what was read. */
  detail: string;
  /**
   * Why the scenario departs from the product's published OpenAPI spec, when
   * it does: an undocumented status, a body the spec's schema rejects, or a
   * body cut short. The scenario contract test reports it instead of failing.
   */
  outside_spec?: string;
}

export interface ScenarioRequest {
  method: "GET" | "POST";
  path: string;
  /** Match only requests for this database. */
  db?: string;
  /** Match only queries that match this pattern. */
  q?: RegExp;
}

/** A fixed status, headers and body. */
export interface ScriptedBody {
  status: number;
  headers?: Record<string, string>;
  body: string | object;
  /** Wait this long before responding. */
  delayMs?: number;
}

/**
 * A table of rows. The fake encodes them in the requested `format` and
 * applies a trailing `LIMIT n` in the query, as the server would, so a test
 * observes how many rows the MCP server asked for without asserting on SQL.
 */
export interface ScriptedTable {
  table: Array<Record<string, unknown>>;
  /**
   * Fail after sending `afterRows` rows and part of the next one, or right
   * after the headers when `afterRows` is 0. `truncate` ends the response
   * cleanly; `abort` destroys the connection.
   */
  interrupt?: { afterRows: number; mode: "truncate" | "abort" };
}

export interface Scenario {
  name: string;
  provenance: ScenarioProvenance;
  request: ScenarioRequest;
  response: ScriptedBody | ScriptedTable;
}

export const ROWS_ARRAY_OUTSIDE_SPEC =
  "The spec documents a JSON object with `results`. Core and Enterprise 3.11.7 and 3.12.1 return a top-level array of rows, which the MCP server parses.";

/** Database the protocol tests seed and query on a live testbench. */
export const TRUST_DB = "mcp_test_trust";

/**
 * Five `cpu` rows at fixed timestamps. Live runs seed the same points with
 * `CPU_LINE_PROTOCOL`, so re-seeding overwrites rather than appends.
 */
export const CPU_ROWS: Array<Record<string, unknown>> = [
  { host: "a", time: "2024-03-09T16:00:00", usage: 10.5 },
  { host: "a", time: "2024-03-09T16:01:00", usage: 11.5 },
  { host: "a", time: "2024-03-09T16:02:00", usage: 12.5 },
  { host: "a", time: "2024-03-09T16:03:00", usage: 13.5 },
  { host: "a", time: "2024-03-09T16:04:00", usage: 14.5 },
];

export const CPU_LINE_PROTOCOL = [
  "cpu,host=a usage=10.5 1710000000",
  "cpu,host=a usage=11.5 1710000060",
  "cpu,host=a usage=12.5 1710000120",
  "cpu,host=a usage=13.5 1710000180",
  "cpu,host=a usage=14.5 1710000240",
].join("\n");

export const CORE_SQL_CPU_TABLE: Scenario = {
  name: "core-sql-cpu-table",
  provenance: {
    products: ["core", "enterprise"],
    version: "3.12.1",
    source: "live",
    detail:
      "Testbench run 2026-10-15, Core and Enterprise 3.11.7 and 3.12.1: format=json returns a top-level array of row objects, and an empty result is `[]`. jsonl returns one object per line; csv returns a header row, then one row per line.",
    outside_spec: ROWS_ARRAY_OUTSIDE_SPEC,
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu"?(?!\w)/iu,
  },
  response: { table: CPU_ROWS },
};

/** Planning fails before any row is sent: an error status and body. */
export const CORE_SQL_UNKNOWN_TABLE: Scenario = {
  name: "core-sql-unknown-table",
  provenance: {
    products: ["core", "enterprise"],
    version: "3.12.1",
    source: "live",
    detail:
      "Testbench run 2026-10-15, Core and Enterprise 3.11.7 and 3.12.1: 400 with a plain-text body and no content-type.",
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?no_such_table"?(?!\w)/iu,
  },
  response: {
    status: 400,
    body: "Error during planning: table 'public.iox.no_such_table' not found",
  },
};

/**
 * The stream fails after two rows. No live run has caused this: on Core and
 * Enterprise 3.11.7 and 3.12.1, every memory failure came before the first
 * row. This scripts both plausible endings.
 */
export function coreSqlInterrupted(mode: "truncate" | "abort"): Scenario {
  return {
    name: `core-sql-interrupted-${mode}`,
    provenance: {
      products: ["core"],
      version: "3.11.7",
      source: "source-inspection",
      detail:
        "Unobserved. A 200 JSON response that stops after two rows. Testbench run 2026-10-15 tried small memory pools on Core and Enterprise 3.11.7 and 3.12.1, and no query failed after its first row.",
      outside_spec:
        "A response cut short is outside every documented response.",
    },
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      db: TRUST_DB,
      q: /\bFROM\s+"?cpu_stream_fail"?(?!\w)/iu,
    },
    response: { table: CPU_ROWS, interrupt: { afterRows: 2, mode } },
  };
}

/**
 * The query runs out of memory before its first row. Core and Enterprise
 * 3.11.7 send the 200 headers, then drop the connection with no body.
 * 3.12.1 returns an error status instead (CORE_SQL_POOL_EXHAUSTED_STATUS).
 */
export const CORE_SQL_POOL_EXHAUSTED_DROP: Scenario = {
  name: "core-sql-pool-exhausted-drop",
  provenance: {
    products: ["core", "enterprise"],
    version: "3.11.7",
    source: "live",
    detail:
      "Testbench run 2026-10-15, Core 3.11.7 with INFLUXDB3_EXEC_MEM_POOL_SIZE at 4 MB: json, jsonl and csv each sent 200 headers, 0 body bytes, then closed the connection (curl exit 18). Enterprise 3.11.7 did the same at 1 MB.",
    outside_spec:
      "A 200 response with no body is outside every documented response.",
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu_pool_exhausted"?(?!\w)/iu,
  },
  response: { table: CPU_ROWS, interrupt: { afterRows: 0, mode: "abort" } },
};

/**
 * The query runs out of memory before its first row, on Core 3.12.1: a 500
 * with a plain-text body, in every format.
 */
export const CORE_SQL_POOL_EXHAUSTED_STATUS: Scenario = {
  name: "core-sql-pool-exhausted-status",
  provenance: {
    products: ["core"],
    version: "3.12.1",
    source: "live",
    detail:
      "Testbench run 2026-10-15, Core 3.12.1 with INFLUXDB3_EXEC_MEM_POOL_SIZE at 4 MB: json, jsonl and csv each returned 500 with a plain-text body and no content-type. Enterprise 3.12.1 returns 429 for the same failure.",
    outside_spec: "The spec documents no 500 for query_sql.",
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu_pool_exhausted_status"?(?!\w)/iu,
  },
  response: {
    status: 500,
    body: "External error: Execution error for 'deduplicate batches'\ncaused by\nResources exhausted: Additional allocation failed for SortPreservingMergeExec[0] with top memory consumers (across reservations) as:\n  SortPreservingMergeExec[0]#1001(can spill: false) consumed 3.9 MB, peak 3.9 MB.",
  },
};

/**
 * A 200 whose body ends cleanly before the first row. A JSON result is never
 * an empty body, so this is a failed query, not "no rows".
 */
export const CORE_SQL_EMPTY_BODY: Scenario = {
  name: "core-sql-empty-body",
  provenance: {
    products: ["core"],
    version: "3.11.7",
    source: "source-inspection",
    detail:
      "Unobserved. The 3.11.6 Enterprise release notes say json, jsonl and csv end the response early when memory runs out. Testbench run 2026-10-15 saw a dropped connection instead (CORE_SQL_POOL_EXHAUSTED_DROP), and `[]` for an empty result.",
    outside_spec:
      "A 200 response with no body is outside every documented response.",
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu_empty_body"?(?!\w)/iu,
  },
  response: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: "",
  },
};

export const CORE_INFLUXQL_CPU_TABLE: Scenario = {
  name: "core-influxql-cpu-table",
  provenance: {
    products: ["core", "enterprise"],
    version: "3.12.1",
    source: "live",
    detail:
      "Testbench run 2026-10-15, Core and Enterprise 3.11.7 and 3.12.1: a top-level array of row objects, and an empty result is `[]`. Each row has iox::measurement, and time has no Z suffix.",
    outside_spec: ROWS_ARRAY_OUTSIDE_SPEC,
  },
  request: {
    method: "POST",
    path: "/api/v3/query_influxql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu"?(?!\w)/iu,
  },
  response: {
    table: CPU_ROWS.map((row) => ({ "iox::measurement": "cpu", ...row })),
  },
};

/** #84's shape: JSON rows returned for a CSV request. */
export const CORE_SQL_CSV_RETURNS_JSON: Scenario = {
  name: "core-sql-csv-returns-json",
  provenance: {
    products: ["core"],
    version: "unknown",
    source: "source-inspection",
    detail:
      "Not observed on Core or Enterprise. Mirrors the Cloud Dedicated report in #84, where JSON rows came back for a CSV request.",
    outside_spec: ROWS_ARRAY_OUTSIDE_SPEC,
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu_json_only"?(?!\w)/iu,
  },
  response: { status: 200, body: CPU_ROWS.slice(0, 2) },
};

/** Deliberate format mismatches to check decoding against response headers. */
export const CORE_SQL_FORMAT_MISMATCHES: Scenario[] = [
  [
    "cpu_jsonl_only",
    "application/x-ndjson; charset=utf-8",
    '{"usage":1}\n{"usage":2}\n',
  ],
  ["cpu_csv_only", "text/csv; charset=utf-8", "usage\n1\n2\n"],
].map(([table, contentType, body]) => ({
  name: `core-sql-${table}`,
  provenance: {
    products: ["core", "enterprise"],
    version: "unknown",
    source: "source-inspection",
    detail:
      "Synthetic response-format mismatch to verify media-type decoding and row bounds; not a live product observation.",
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: new RegExp(`\\bFROM\\s+${table}\\b`, "iu"),
  },
  response: { status: 200, headers: { "content-type": contentType }, body },
}));

/** A query that takes longer than any small client timeout. */
export const CORE_SQL_SLOW: Scenario = {
  name: "core-sql-slow",
  provenance: {
    products: ["core"],
    version: "3.11.5",
    source: "source-inspection",
    detail:
      "Answers after 2 s so a client-side timeoutMs fires first. The server's own timeout response is unobserved.",
    outside_spec: ROWS_ARRAY_OUTSIDE_SPEC,
  },
  request: {
    method: "POST",
    path: "/api/v3/query_sql",
    db: TRUST_DB,
    q: /\bFROM\s+"?cpu_slow"?(?!\w)/iu,
  },
  response: { status: 200, body: CPU_ROWS, delayMs: 2_000 },
};

/** Every scenario, for the scenario contract test. Add new ones here. */
export const ALL_SCENARIOS: Scenario[] = [
  CORE_SQL_CPU_TABLE,
  CORE_SQL_UNKNOWN_TABLE,
  coreSqlInterrupted("truncate"),
  coreSqlInterrupted("abort"),
  CORE_SQL_POOL_EXHAUSTED_DROP,
  CORE_SQL_POOL_EXHAUSTED_STATUS,
  CORE_SQL_EMPTY_BODY,
  CORE_INFLUXQL_CPU_TABLE,
  CORE_SQL_CSV_RETURNS_JSON,
  ...CORE_SQL_FORMAT_MISMATCHES,
  CORE_SQL_SLOW,
];
