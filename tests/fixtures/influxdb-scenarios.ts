export interface ScenarioProvenance {
  products: Array<"core" | "enterprise">;
  version: string;
  source: "live" | "claim" | "source-inspection";
  detail: string;
  outside_spec?: string;
}

export interface ScenarioRequest {
  method: "GET" | "POST";
  path: string;
  db?: string;
  q?: RegExp;
}

export interface ScriptedFixedResponse {
  status: number;
  headers?: Record<string, string>;
  body: string | object;
  delayMs?: number;
}

export interface TableInterruption {
  rowsBeforeFailure: number;
  mode: "truncate" | "abort";
}

export interface ScriptedTable {
  table: Array<Record<string, unknown>>;
  interrupt?: TableInterruption;
}

export interface Scenario {
  name: string;
  provenance: ScenarioProvenance;
  request: ScenarioRequest;
  response: ScriptedFixedResponse | ScriptedTable;
}

export const ROWS_ARRAY_OUTSIDE_SPEC =
  "The spec documents a JSON object with `results`. Core and Enterprise 3.11.7 and 3.12.1 return a top-level array of rows, which the MCP server parses.";

export const TRUST_DB = "mcp_test_trust";

export const CPU_ROWS: Array<Record<string, unknown>> = [
  { host: "a", time: "2024-03-09T16:00:00", usage: 10.5 },
  { host: "a", time: "2024-03-09T16:01:00", usage: 11.5 },
  { host: "a", time: "2024-03-09T16:02:00", usage: 12.5 },
  { host: "a", time: "2024-03-09T16:03:00", usage: 13.5 },
  { host: "a", time: "2024-03-09T16:04:00", usage: 14.5 },
];

function utcEpochSeconds(isoTimeWithoutZone: unknown): number {
  return Date.parse(`${isoTimeWithoutZone}Z`) / 1000;
}

export const CPU_LINE_PROTOCOL = CPU_ROWS.map(
  ({ host, usage, time }) =>
    `cpu,host=${host} usage=${usage} ${utcEpochSeconds(time)}`,
).join("\n");

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
    response: { table: CPU_ROWS, interrupt: { rowsBeforeFailure: 2, mode } },
  };
}

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
  response: {
    table: CPU_ROWS,
    interrupt: { rowsBeforeFailure: 0, mode: "abort" },
  },
};

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

const SLOWER_THAN_CLIENT_TIMEOUT_MS = 2_000;

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
  response: {
    status: 200,
    body: CPU_ROWS,
    delayMs: SLOWER_THAN_CLIENT_TIMEOUT_MS,
  },
};

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
