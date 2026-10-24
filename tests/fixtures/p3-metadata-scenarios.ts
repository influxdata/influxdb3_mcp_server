import type { Scenario, ScenarioProvenance } from "./influxdb-scenarios.js";

const provenance: ScenarioProvenance = {
  products: ["core", "enterprise"],
  version: "3.12.1",
  source: "live",
  detail:
    "2026-10-22 isolated P3 fixture on Core 692ea4a994 and Enterprise d86454e254. See e2e-results/2026-10-22-p3-metadata/README.md. Fixture names normalized.",
  outside_spec:
    "The query spec documents an object response; the live server returns an array of rows.",
};

export const P3_METADATA_SCENARIOS: Scenario[] = [
  {
    name: "P3 information schema columns",
    provenance,
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      q: /SELECT column_name/u,
    },
    response: {
      status: 200,
      body: [
        { column_name: "host", data_type: "Dictionary(Int32, Utf8)" },
        { column_name: "note", data_type: "Utf8" },
        { column_name: "time", data_type: "Timestamp(ns)" },
        { column_name: "value", data_type: "Float64" },
      ],
    },
  },
  {
    name: "P3 database-local column roles",
    provenance,
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      q: /FROM system\.influxdb_schema/u,
    },
    response: {
      status: 200,
      body: [
        { key: "host", data_type: "tag" },
        { key: "note", data_type: "string" },
        { key: "time", data_type: "time" },
        { key: "value", data_type: "float" },
      ],
    },
  },
  {
    name: "P3 active implicit table catalog",
    provenance,
    request: {
      method: "POST",
      path: "/api/v3/query_sql",
      db: "_internal",
      q: /FROM system\.tables/u,
    },
    response: {
      status: 200,
      body: [{ deleted: false, schema_mode: "implicit" }],
    },
  },
];
