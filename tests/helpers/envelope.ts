/**
 * Validate tool responses against the committed envelope schema, so any test
 * that calls a tool through `callTool` also checks the contract, on the fake
 * and on a live instance alike.
 */

import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

const SCHEMA_PATH = resolve(
  import.meta.dirname,
  "../../schemas/read-only-response.schema.json",
);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv({ allErrors: true });
ajv.addSchema(schema);

const validateQueryResponse = ajv.getSchema(schema.$id)!;
const validateToolError = ajv.getSchema(
  `${schema.$id}#/definitions/toolError`,
)!;

const QUERY_TOOLS = new Set(["query_sql", "query_influxql"]);

/**
 * Query tools must match the full schema. Other tools are checked only when
 * they fail, until their success shapes join the schema.
 */
export function expectValidEnvelope(toolName: string, body: any): void {
  const validate = QUERY_TOOLS.has(toolName)
    ? validateQueryResponse
    : body?.ok === false
      ? validateToolError
      : undefined;
  if (!validate || validate(body)) return;

  expect.fail(
    `${toolName} response does not match ${SCHEMA_PATH}:\n${ajv.errorsText(validate.errors, { separator: "\n" })}\n${JSON.stringify(body, null, 2)}`,
  );
}
