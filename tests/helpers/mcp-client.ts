import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { expectValidEnvelope } from "./envelope.js";

const SERVER_PATH = resolve(import.meta.dirname, "../../build/index.js");

const BASE_ENV: Record<string, string> = {
  INFLUX_DB_INSTANCE_URL: "http://localhost:19999/",
  INFLUX_DB_TOKEN: "test-token-not-used",
  INFLUX_DB_PRODUCT_TYPE: "core",
};

export interface TestClient {
  client: Client;
  close: () => Promise<void>;
}

export async function createTestClient(
  env?: Record<string, string>,
): Promise<TestClient> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await client.connect(transport);

  const close = async () => {
    try {
      await client.close();
    } catch {
      // Server process may already be gone
    }
  };

  return { client, close };
}

/**
 * Call a structured tool, check its response against the envelope schema,
 * and return the parsed envelope.
 */
export async function callTool(
  test: TestClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ body: any; isError: boolean }> {
  const result = await test.client.callTool({ name, arguments: args });
  const body = toolJson(result);
  expectValidEnvelope(name, body);
  return { body, isError: result.isError === true };
}

/** Parse the JSON envelope a structured tool returns in its text content. */
export function toolJson<T = any>(result: unknown): T {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return JSON.parse(content[0]?.text) as T;
}
