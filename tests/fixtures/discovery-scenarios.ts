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

const NOT_AUTHENTICATED = { error: "the request was not authenticated" };

function live(
  products: ScenarioProvenance["products"],
  detail: string,
): ScenarioProvenance {
  return {
    products,
    version: "3.12.1",
    source: "live",
    detail: `Testbench run 2026-10-15, 3.12.1: ${detail}`,
  };
}

function assumed(detail: string, outside_spec?: string): ScenarioProvenance {
  return {
    ...SYNTHETIC,
    detail: `Unobserved. ${detail}`,
    ...(outside_spec && { outside_spec }),
  };
}

function access(
  method: "GET" | "POST",
  path: string,
  status: 401 | 403 | 404,
  provenance: ScenarioProvenance,
  body: string | object,
): Scenario {
  const outcome = ACCESS_OUTCOMES.find((item) => item.status === status)!;
  return {
    name: `${path}: ${outcome.name}`,
    provenance,
    request: { method, path },
    response: { status, body },
  };
}

/** Every endpoint the read-only tools call, failing with each access status. */
export const ACCESS_SCENARIOS: Scenario[] = [
  access(
    "POST",
    "/api/v3/query_sql",
    401,
    live(["core", "enterprise"], "no token, or an invalid token."),
    NOT_AUTHENTICATED,
  ),
  access(
    "POST",
    "/api/v3/query_influxql",
    401,
    assumed("Body copied from the 401 observed on query_sql."),
    NOT_AUTHENTICATED,
  ),
  access(
    "GET",
    "/api/v3/configure/database",
    401,
    assumed("Body copied from the 401 observed on query_sql."),
    NOT_AUTHENTICATED,
  ),
  access(
    "GET",
    "/health",
    401,
    live(["core", "enterprise"], "an invalid token."),
    NOT_AUTHENTICATED,
  ),
  access(
    "GET",
    "/ping",
    401,
    assumed("Body copied from the 401 observed on /health."),
    NOT_AUTHENTICATED,
  ),
  access(
    "POST",
    "/api/v3/query_sql",
    403,
    live(
      ["enterprise"],
      "a scoped token, for a denied database and for one that does not exist alike. Empty body.",
    ),
    "",
  ),
  access(
    "POST",
    "/api/v3/query_influxql",
    403,
    live(["enterprise"], "a scoped token, for a denied database. Empty body."),
    "",
  ),
  access(
    "GET",
    "/api/v3/configure/database",
    403,
    assumed(
      "A scoped token got 200 with only its own databases. Body copied from the observed 403s.",
      "The public database-list spec omits 403.",
    ),
    "",
  ),
  access(
    "GET",
    "/health",
    403,
    live(["enterprise"], "a scoped token. Empty body."),
    "",
  ),
  access(
    "GET",
    "/ping",
    403,
    live(["enterprise"], "a scoped token. Empty body."),
    "",
  ),
  ...(["/api/v3/query_sql", "/api/v3/query_influxql"] as const).map((path) =>
    access(
      "POST",
      path,
      404,
      live(["core", "enterprise"], "an admin token, for an unknown database."),
      { error: "query error: database not found: no_such_db" },
    ),
  ),
  ...(["/api/v3/configure/database", "/health", "/ping"] as const).map((path) =>
    access(
      "GET",
      path,
      404,
      assumed(
        "Body copied from the 404 observed for an unknown endpoint.",
        path === "/health" ? "The public health spec omits 404." : undefined,
      ),
      "Not found",
    ),
  ),
];

/** A 401 whose body repeats the configured token, to check redaction. */
export const TOKEN_ECHO: Scenario = {
  name: "401 that repeats the token",
  provenance: assumed("Tests redaction; no server is known to do this."),
  request: { method: "POST", path: "/api/v3/query_sql" },
  response: {
    status: 401,
    body: { error: "token test-token-not-used is not valid" },
  },
};

export function accessScenariosFor(status: number): Scenario[] {
  return ACCESS_SCENARIOS.filter(
    (scenario) =>
      "status" in scenario.response && scenario.response.status === status,
  );
}

const OBSERVED_RECOVERY: Record<number, [ScenarioProvenance, string]> = {
  405: [
    live(
      ["enterprise"],
      "query_sql and query_influxql on an ingest-only node.",
    ),
    "This feature is not implemented: this node does not run the `query` mode, so it serves only system table queries. Restart it with `--mode query`, or send this query to a query node in the cluster",
  ],
  429: [
    live(
      ["enterprise"],
      "a sort that ran out of the query memory pool. No Retry-After header.",
    ),
    "Not enough memory to continue external sort. Consider increasing the memory limit, or decreasing sort_spill_reservation_bytes\ncaused by\nResources exhausted: Additional allocation failed for ExternalSorter[0] with top memory consumers (across reservations) as:",
  ],
};

const UNDOCUMENTED_STATUS = "The public query spec omits this status.";

/**
 * Failures with no recovery classification yet, with and without
 * Retry-After. The observed 405 and 429 carry no Retry-After; the variants
 * with one are synthetic.
 */
export const RECOVERY_SCENARIOS: Scenario[] = [405, 429, 503, 504].flatMap(
  (status) =>
    [undefined, "2"].map((wait): Scenario => {
      const observed = wait ? undefined : OBSERVED_RECOVERY[status];
      const outside_spec = status === 405 ? undefined : UNDOCUMENTED_STATUS;
      return {
        name: `${status}-${wait ? "retry-after" : "no-wait"}`,
        provenance: observed
          ? { ...observed[0], ...(outside_spec && { outside_spec }) }
          : assumed("Synthetic server failure.", outside_spec),
        request: { method: "POST", path: "/api/v3/query_sql" },
        response: {
          status,
          body: observed?.[1] ?? { error: "unverified server failure" },
          ...(wait && { headers: { "retry-after": wait } }),
        },
      };
    }),
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
    provenance: {
      ...live(
        ["enterprise"],
        "a scoped token got rows of `iox::database`, listing only its own databases.",
      ),
      outside_spec:
        "The spec documents `{ databases: [names] }`; the server returns an array of `iox::database` rows.",
    },
    request: { method: "GET", path: "/api/v3/configure/database" },
    response: {
      status: 200,
      body: ["smoke", "denied", "empty"].map((name) => ({
        "iox::database": name,
      })),
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
