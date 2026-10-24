/**
 * Validate tool responses and telemetry events against the committed
 * schemas, so any test that calls a tool through `callTool` also checks the
 * contract, on the fake and on a live instance alike.
 */

import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

const ENVELOPE_PATH = resolve(
  import.meta.dirname,
  "../../schemas/read-only-response.schema.json",
);
const TELEMETRY_PATH = resolve(
  import.meta.dirname,
  "../../schemas/telemetry-event.schema.json",
);

const ajv = new Ajv({ allErrors: true });
const validateEnvelope = ajv.compile(
  JSON.parse(readFileSync(ENVELOPE_PATH, "utf8")),
);
const validateTelemetry = ajv.compile(
  JSON.parse(readFileSync(TELEMETRY_PATH, "utf8")),
);

export function expectValidEnvelope(body: unknown, label = "response"): void {
  if (validateEnvelope(body)) return;
  expect.fail(
    `${label} does not match ${ENVELOPE_PATH}:\n${ajv.errorsText(validateEnvelope.errors, { separator: "\n" })}\n${JSON.stringify(body, null, 2)}`,
  );
}

export function expectValidTelemetry(event: unknown): void {
  if (validateTelemetry(event)) return;
  expect.fail(
    `telemetry event does not match ${TELEMETRY_PATH}:\n${ajv.errorsText(validateTelemetry.errors, { separator: "\n" })}\n${JSON.stringify(event, null, 2)}`,
  );
}
