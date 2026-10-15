import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { Ajv } from "ajv";
import { expect } from "vitest";

const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
function loadSchema(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/contracts/${name}.schema.json`, import.meta.url),
      "utf8",
    ),
  );
}
const envelope = ajv.compile(loadSchema("readonly-envelope"));
const telemetry = ajv.compile(loadSchema("telemetry"));

export function assertEnvelope(value: unknown) {
  expect(envelope(value), JSON.stringify(envelope.errors)).toBe(true);
}

export function assertTelemetry(value: unknown) {
  expect(telemetry(value), JSON.stringify(telemetry.errors)).toBe(true);
}
