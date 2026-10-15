import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESS_SCENARIOS,
  DISCOVERY_SCENARIOS,
  INGEST_NODE_QUERY,
  RECOVERY_SCENARIOS,
  SAMPLES_DENIED_OR_EMPTY,
} from "./fixtures/discovery-scenarios.js";
import { ALL_SCENARIOS, Scenario } from "./fixtures/influxdb-scenarios.js";

// Checks each fake-server scenario against the pinned OpenAPI excerpt for
// each product it stands for (refresh with
// scripts/snapshot-protocol-openapi.py). A scenario the spec can't describe
// must say why in `provenance.outside_spec`; the test then reports it
// instead of failing, so drift between the spec, the fake, and live servers
// stays visible. A scenario the spec does describe must not carry a stale
// `outside_spec`.

type Product = Scenario["provenance"]["products"][number];

const SPECS: Record<Product, any> = {
  core: loadSpec("core"),
  enterprise: loadSpec("enterprise"),
};

function loadSpec(product: Product): any {
  return JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `fixtures/openapi/${product}-openapi.json`),
      "utf8",
    ),
  );
}

const SCENARIOS = [
  ...ALL_SCENARIOS,
  ...ACCESS_SCENARIOS,
  ...RECOVERY_SCENARIOS,
  INGEST_NODE_QUERY,
  ...DISCOVERY_SCENARIOS,
  ...SAMPLES_DENIED_OR_EMPTY,
];

const ajv = new Ajv({ strict: false, allErrors: true });

/** Every way the scenario departs from the spec, empty when it conforms. */
function specGaps(scenario: Scenario, spec: any): string[] {
  const operation =
    spec.paths[scenario.request.path]?.[scenario.request.method.toLowerCase()];
  if (!operation) {
    return [
      `${scenario.request.method} ${scenario.request.path} is not an operation`,
    ];
  }

  const scripted = scenario.response;
  const status = "table" in scripted ? 200 : scripted.status;
  let response =
    operation.responses[String(status)] ?? operation.responses.default;
  if (!response) return [`status ${status} is not documented`];
  if (response.$ref) {
    response = spec.components.responses[response.$ref.split("/").at(-1)];
  }

  const gaps: string[] = [];
  let jsonBody: unknown;
  if ("table" in scripted) {
    if (scripted.interrupt) gaps.push("the body ends before the result does");
    else jsonBody = scripted.table;
  } else if (typeof scripted.body === "object") {
    jsonBody = scripted.body;
  } else if (scripted.headers?.["content-type"] === "application/json") {
    try {
      jsonBody = JSON.parse(scripted.body);
    } catch {
      gaps.push("the JSON body does not parse");
    }
  }

  const content = response.content;
  const schema = content?.["application/json"]?.schema;
  if (jsonBody !== undefined && content && !content["application/json"]) {
    gaps.push(
      `the spec documents no JSON body for status ${status}, only ${Object.keys(content).join(", ")}`,
    );
  } else if (jsonBody !== undefined && schema) {
    const validate = ajv.compile({ ...schema, components: spec.components });
    if (!validate(jsonBody)) {
      gaps.push(`JSON body: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return gaps;
}

describe("fake-server scenarios against the pinned OpenAPI specs", () => {
  it.for(["core", "enterprise"] as const)(
    "pins the %s spec to a docs-v2 commit",
    (product) => {
      expect(SPECS[product].provenance.commit).toMatch(/^[a-f0-9]{40}$/u);
    },
  );

  const cases = SCENARIOS.flatMap((scenario) =>
    scenario.provenance.products.map(
      (product) => [`${product} ${scenario.name}`, product, scenario] as const,
    ),
  );
  it.for(cases)("%s", ([, product, scenario], context) => {
    const gaps = specGaps(scenario, SPECS[product]);
    if (gaps.length === 0) {
      expect(scenario.provenance.outside_spec).toBeUndefined();
      return;
    }

    expect(
      scenario.provenance.outside_spec,
      `${scenario.name} departs from the ${product} spec (${gaps.join("; ")}) but its provenance doesn't say why`,
    ).toBeTruthy();
    context.annotate(
      `Outside the spec: ${gaps.join("; ")}. ${scenario.provenance.outside_spec}`,
    );
  });
});
