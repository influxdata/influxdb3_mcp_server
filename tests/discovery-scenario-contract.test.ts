import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { Ajv } from "ajv";
import {
  recordedScenarios,
  recoveryScenarios,
  discoveryScenarios,
} from "./fixtures/discovery-scenarios.js";

describe("[fake-only] saved scenario contracts against pinned public OpenAPI", () => {
  for (const product of ["core", "enterprise"]) {
    const spec = JSON.parse(
      readFileSync(
        new URL(
          `./fixtures/contracts/${product}-openapi.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const ajv = new Ajv({ strict: false, validateFormats: false });
    for (const scenario of [
      ...recordedScenarios,
      ...recoveryScenarios,
      ...Object.values(discoveryScenarios),
    ]) {
      it(`${product} ${scenario.name}`, () => {
        expect(spec.provenance.commit).toMatch(/^[a-f0-9]{40}$/);
        const operation =
          spec.paths[scenario.request.path]?.[scenario.request.method];
        expect(operation).toBeDefined();
        let response = operation.responses[String(scenario.response.status)];
        if (!response) {
          expect(
            "specException" in scenario ? scenario.specException : undefined,
            "Undocumented status requires a provenance exception",
          ).toBeTruthy();
          console.warn(
            `[scenario contract] ${product} ${scenario.name}: ${"specException" in scenario ? scenario.specException : undefined}`,
          );
          return;
        }
        if (response.$ref) {
          response = spec.components.responses[response.$ref.split("/").at(-1)];
        }
        const schema = response.content?.["application/json"]?.schema;
        if (schema) {
          const validate = ajv.compile({
            ...schema,
            components: spec.components,
          });
          if (!validate(scenario.response.body)) {
            expect(
              "specException" in scenario && scenario.specException,
              JSON.stringify(validate.errors),
            ).toBeTruthy();
            console.warn(
              `[scenario contract] ${product} ${scenario.name}: ${"specException" in scenario ? scenario.specException : ""}`,
            );
          }
        }
        expect(scenario.provenance.source).toContain("synthetic");
      });
    }
  }
});
