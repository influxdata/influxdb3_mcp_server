/**
 * Scripted responses for the discovery, access, and recovery tests. They use
 * the scenario type and fake server in `influxdb-scenarios.ts`.
 */

import {
  ROWS_ARRAY_OUTSIDE_SPEC,
  type Scenario,
  type ScenarioProvenance,
} from "./influxdb-scenarios.js";

const SYNTHETIC: ScenarioProvenance = {
  products: ["core", "enterprise"],
  version: "unknown",
  source: "source-inspection",
  detail:
    "Synthetic, from the P2 to P4 specifications. Unconfirmed against a live run.",
};

/** What each access failure must become in a tool error. */
export const ACCESS_OUTCOMES = [
  {
    name: "invalid credential",
    status: 401,
    code: "credential_invalid",
    recovery: "renew_credential",
  },
  { name: "denied", status: 403, code: "access_denied", recovery: "none" },
  {
    name: "ambiguous absence",
    status: 404,
    code: "not_found_or_denied",
    recovery: "none",
  },
] as const;

const ACCESS_PATHS = [
  ["POST", "/api/v3/query_sql"],
  ["POST", "/api/v3/query_influxql"],
  ["GET", "/api/v3/configure/database"],
  ["GET", "/health"],
  ["GET", "/ping"],
] as const;

/** Every endpoint the read-only tools call, failing with one access status. */
export const ACCESS_SCENARIOS: Scenario[] = ACCESS_PATHS.flatMap(
  ([method, path]) =>
    ACCESS_OUTCOMES.map(({ name, status }) => ({
      name: `${path}: ${name}`,
      provenance: {
        ...SYNTHETIC,
        ...(path === "/api/v3/configure/database" &&
          status === 403 && {
            outside_spec:
              "The public database-list spec omits 403; synthetic denial until confirmed live.",
          }),
        ...(path === "/health" &&
          status === 404 && {
            outside_spec:
              "The public health spec omits 404; synthetic missing endpoint until confirmed live.",
          }),
      },
      request: { method, path },
      response: {
        status,
        body: { error: "server detail test-token-not-used" },
      },
    })),
);

export function accessScenariosFor(status: number): Scenario[] {
  return ACCESS_SCENARIOS.filter(
    (scenario) =>
      "status" in scenario.response && scenario.response.status === status,
  );
}

/** Failures with no observed recovery, with and without Retry-After. */
export const RECOVERY_SCENARIOS: Scenario[] = [405, 429, 503, 504].flatMap(
  (status) =>
    [undefined, "2"].map((wait) => ({
      name: `unverified-${status}-${wait ?? "no-wait"}`,
      provenance: {
        ...SYNTHETIC,
        ...(status !== 405 && {
          outside_spec:
            "The public query spec omits this status. Synthetic until an operator records the live response.",
        }),
      },
      request: { method: "POST" as const, path: "/api/v3/query_sql" },
      response: {
        status,
        body: { error: "unverified server failure" },
        ...(wait && { headers: { "retry-after": wait } }),
      },
    })),
);

/**
 * A `smoke` database with four tables, one of whose schemas is denied, a
 * denied database, and an empty one. The first match answers, so the
 * specific queries come before the catch-all samples.
 */
export const DISCOVERY_SCENARIOS: Scenario[] = [
  {
    name: "health legacy JSON",
    provenance: {
      ...SYNTHETIC,
      outside_spec:
        "The public health schema describes plain text; this synthetic legacy JSON response tests existing compatibility.",
    },
    request: { method: "GET", path: "/health" },
    response: { status: 200, body: { status: "pass" } },
  },
  {
    name: "ping",
    provenance: SYNTHETIC,
    request: { method: "GET", path: "/ping" },
    response: { status: 200, body: {} },
  },
  {
    name: "visible databases",
    provenance: SYNTHETIC,
    request: { method: "GET", path: "/api/v3/configure/database" },
    response: {
      status: 200,
      body: { databases: ["smoke", "denied", "empty"] },
    },
  },
  {
    name: "denied database",
    provenance: SYNTHETIC,
    request: { method: "POST", path: "/api/v3/query_sql", db: "denied" },
    response: { status: 403, body: { error: "read denied" } },
  },
  ...["empty", "_internal"].map(
    (db): Scenario => ({
      name: `empty query on ${db}`,
      provenance: { ...SYNTHETIC, outside_spec: ROWS_ARRAY_OUTSIDE_SPEC },
      request: { method: "POST", path: "/api/v3/query_sql", db },
      response: { status: 200, body: [] },
    }),
  ),
  {
    name: "unsorted tables with advisory tombstone",
    provenance: { ...SYNTHETIC, outside_spec: ROWS_ARRAY_OUTSIDE_SPEC },
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      db: "smoke",
      q: /SELECT DISTINCT table_name FROM information_schema\.columns/u,
    },
    response: {
      status: 200,
      body: ["zeta", "beta", "alpha", "metrics-1720000000"].map(
        (table_name) => ({ table_name }),
      ),
    },
  },
  {
    name: "denied table metadata",
    provenance: SYNTHETIC,
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      q: /column_name.*'beta'/u,
    },
    response: { status: 403, body: { error: "schema denied" } },
  },
  {
    name: "column metadata",
    provenance: { ...SYNTHETIC, outside_spec: ROWS_ARRAY_OUTSIDE_SPEC },
    request: { method: "POST", path: "/api/v3/query_sql", q: /column_name/u },
    response: {
      status: 200,
      body: [
        { column_name: "time", data_type: "Timestamp" },
        { column_name: "value", data_type: "Float64" },
      ],
    },
  },
  ...(["/api/v3/query_sql", "/api/v3/query_influxql"] as const).map(
    (path): Scenario => ({
      name: `sample row from ${path}`,
      provenance: { ...SYNTHETIC, outside_spec: ROWS_ARRAY_OUTSIDE_SPEC },
      request: { method: "POST", path },
      response: {
        status: 200,
        body: [{ time: "2026-10-15T00:00:00Z", value: 2 }],
      },
    }),
  ),
];

/** Sampling `alpha` is denied, and every other sample window is empty. */
export const SAMPLES_DENIED_OR_EMPTY: Scenario[] = [
  {
    name: "denied sample",
    provenance: SYNTHETIC,
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      q: /^SELECT \* FROM "alpha"/u,
    },
    response: { status: 403, body: { error: "sample denied" } },
  },
  {
    name: "empty sample window",
    provenance: { ...SYNTHETIC, outside_spec: ROWS_ARRAY_OUTSIDE_SPEC },
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      q: /^SELECT \* FROM /u,
    },
    response: { status: 200, body: [] },
  },
];
