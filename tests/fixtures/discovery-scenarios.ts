import type { FakeReply, FakeRequest } from "../helpers/fake-influxdb.js";

// Synthetic scenarios are contract tests, not observations of a live release.
export const accessScenarios = [
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

export const scenarioProvenance = {
  product: "core/enterprise",
  version: "unverified",
  source:
    "source inspection and P2–P4 specifications; synthetic until operator confirmation",
};

export const recordedScenarios = [
  ...[
    "/api/v3/query_sql",
    "/api/v3/query_influxql",
    "/api/v3/configure/database",
    "/health",
    "/ping",
  ].flatMap((path) =>
    accessScenarios.map((access) => ({
      name: `${path}: ${access.name}`,
      request: { method: path.includes("query_") ? "post" : "get", path },
      response: {
        status: access.status,
        body: { error: "server detail test-token-not-used" },
      },
      provenance: scenarioProvenance,
      specException:
        path === "/api/v3/configure/database" && access.status === 403
          ? "The public database-list spec omits 403; synthetic denial until confirmed live."
          : path === "/health" && access.status === 404
            ? "The public health spec omits 404; synthetic missing endpoint until confirmed live."
            : undefined,
    })),
  ),
];

export const recoveryScenarios = [405, 429, 503, 504].flatMap((status) =>
  [undefined, "2"].map((wait) => ({
    name: `unverified-${status}-${wait ?? "no-wait"}`,
    request: { method: "post", path: "/api/v3/query_sql" },
    response: {
      status,
      body: { error: "unverified server failure" },
      headers: wait ? { "retry-after": wait } : {},
    },
    provenance: scenarioProvenance,
    specException:
      status === 405
        ? undefined
        : "The public query spec omits this status. Synthetic until an operator records the live response.",
  })),
);

export const discoveryScenarios = {
  health: {
    name: "health legacy JSON",
    request: { method: "get", path: "/health" },
    response: { status: 200, body: { status: "pass" } },
    specException:
      "The public health schema describes plain text; this synthetic legacy JSON response tests existing compatibility.",
    provenance: scenarioProvenance,
  },
  ping: {
    name: "ping",
    request: { method: "get", path: "/ping" },
    response: { status: 200, body: {} },
    provenance: scenarioProvenance,
  },
  databases: {
    name: "visible databases",
    request: { method: "get", path: "/api/v3/configure/database" },
    response: {
      status: 200,
      body: { databases: ["smoke", "denied", "empty"] },
    },
    provenance: scenarioProvenance,
  },
  denied: {
    name: "denied database",
    request: { method: "post", path: "/api/v3/query_sql", db: "denied" },
    response: { status: 403, body: { error: "read denied" } },
    provenance: scenarioProvenance,
  },
  empty: {
    name: "empty query",
    request: { method: "post", path: "/api/v3/query_sql" },
    response: { status: 200, body: [] },
    provenance: scenarioProvenance,
    specException:
      "The public QueryResponse describes an object, while the existing Core HTTP path consumes row arrays. Confirm the array response on the operator target.",
  },
  tables: {
    name: "unsorted tables with advisory tombstone",
    request: {
      method: "post",
      path: "/api/v3/query_sql",
      db: "smoke",
      q: "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'iox'",
    },
    response: {
      status: 200,
      body: ["zeta", "beta", "alpha", "metrics-1720000000"].map(
        (table_name) => ({ table_name }),
      ),
    },
    provenance: scenarioProvenance,
    specException:
      "The public QueryResponse describes an object; this synthetic row-array metadata response needs operator confirmation.",
  },
  deniedSchema: {
    name: "denied table metadata",
    request: { method: "post", path: "/api/v3/query_sql" },
    response: { status: 403, body: { error: "schema denied" } },
    provenance: scenarioProvenance,
  },
  schema: {
    name: "column metadata",
    request: { method: "post", path: "/api/v3/query_sql" },
    response: {
      status: 200,
      body: [
        { column_name: "time", data_type: "Timestamp" },
        { column_name: "value", data_type: "Float64" },
      ],
    },
    provenance: scenarioProvenance,
    specException:
      "The public QueryResponse describes an object; this synthetic row-array metadata response needs operator confirmation.",
  },
  sample: {
    name: "sample row",
    request: { method: "post", path: "/api/v3/query_sql" },
    response: {
      status: 200,
      body: [{ time: "2026-10-15T00:00:00Z", value: 2 }],
    },
    provenance: scenarioProvenance,
    specException:
      "The public QueryResponse describes an object; this synthetic row-array query response needs operator confirmation.",
  },
};

export function discoveryReply(request: FakeRequest): FakeReply {
  if (request.path === "/health") return discoveryScenarios.health.response;
  if (request.path === "/ping") return discoveryScenarios.ping.response;
  if (request.path === "/api/v3/configure/database")
    return discoveryScenarios.databases.response;
  if (request.db === "denied") return discoveryScenarios.denied.response;
  if (request.db === "empty" || request.db === "_internal")
    return discoveryScenarios.empty.response;
  if (request.q?.includes("DISTINCT table_name"))
    return discoveryScenarios.tables.response;
  if (request.q?.includes("column_name"))
    return request.q.includes("'beta'")
      ? discoveryScenarios.deniedSchema.response
      : discoveryScenarios.schema.response;
  return discoveryScenarios.sample.response;
}
