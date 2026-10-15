import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS, Scenario } from "./fixtures/influxdb-scenarios.js";

// Checks each fake-server scenario against the published OpenAPI spec for
// its product (see tests/fixtures/openapi/SOURCE.md). A scenario the spec
// can't describe must say why in `provenance.outside_spec`; the test then
// reports it instead of failing, so drift between the spec, the fake, and
// live servers stays visible.

const SPECS: Record<string, any> = {
  core: JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "fixtures/openapi/influxdb3-core-openapi.json",
      ),
      "utf8",
    ),
  ),
};

const ajv = new Ajv({ strict: false, allErrors: true });

/** Every way the scenario departs from the spec, empty when it conforms. */
function specGaps(scenario: Scenario): string[] {
  const spec = SPECS[scenario.provenance.product];
  const operation =
    spec.paths[scenario.request.path]?.[scenario.request.method.toLowerCase()];
  if (!operation) {
    return [
      `${scenario.request.method} ${scenario.request.path} is not an operation`,
    ];
  }

  const scripted = scenario.response;
  const status = "table" in scripted ? 200 : scripted.status;
  const response =
    operation.responses[String(status)] ?? operation.responses.default;
  if (!response) return [`status ${status} is not documented`];

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
  const schema = response.content?.["application/json"]?.schema;
  if (jsonBody !== undefined && schema) {
    const validate = ajv.compile({ ...schema, components: spec.components });
    if (!validate(jsonBody)) {
      gaps.push(`JSON body: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return gaps;
}

describe("fake-server scenarios against the published OpenAPI spec", () => {
  it.for(ALL_SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    "%s",
    ([, scenario], context) => {
      const gaps = specGaps(scenario);
      if (gaps.length === 0) {
        expect(scenario.provenance.outside_spec).toBeUndefined();
        return;
      }

      expect(
        scenario.provenance.outside_spec,
        `${scenario.name} departs from the spec (${gaps.join("; ")}) but its provenance doesn't say why`,
      ).toBeTruthy();
      context.annotate(
        `Outside the spec: ${gaps.join("; ")}. ${scenario.provenance.outside_spec}`,
      );
    },
  );
});
