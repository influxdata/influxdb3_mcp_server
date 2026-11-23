import net from "node:net";
import axios from "axios";
import { InfluxDBClient } from "@influxdata/influxdb3-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveWriteError } from "../src/services/error-resolution.service.js";

const LINE_WITHOUT_TIMESTAMP = "m,host=a v=1";

let serverThatClosesWithoutReplying: net.Server;
let baseUrl: string;

beforeAll(async () => {
  serverThatClosesWithoutReplying = net.createServer((socket) =>
    socket.once("data", () => socket.end()),
  );
  await new Promise<void>((resolve) =>
    serverThatClosesWithoutReplying.listen(0, "127.0.0.1", resolve),
  );
  const { port } = serverThatClosesWithoutReplying.address() as net.AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  serverThatClosesWithoutReplying.close();
});

async function failureOf(write: () => Promise<unknown>): Promise<unknown> {
  try {
    await write();
  } catch (error) {
    return error;
  }
  throw new Error("the write succeeded");
}

describe("a write whose connection closes without a reply", () => {
  it.each([
    [
      "axios (core, enterprise, clustered)",
      () =>
        failureOf(() =>
          axios.post(
            `${baseUrl}/api/v3/write_lp?db=db`,
            LINE_WITHOUT_TIMESTAMP,
            {
              proxy: false,
            },
          ),
        ),
    ],
    [
      "the client library (cloud-dedicated, cloud-serverless)",
      () =>
        failureOf(async () => {
          const client = new InfluxDBClient({
            host: baseUrl,
            token: "token",
            database: "db",
          });
          try {
            await client.write(LINE_WITHOUT_TIMESTAMP);
          } finally {
            await client.close();
          }
        }),
    ],
  ])("leaves the outcome unknown through %s", async (_client, write) => {
    const error = resolveWriteError(await write(), "db", {
      lineProtocol: LINE_WITHOUT_TIMESTAMP,
      acceptPartial: true,
    });
    expect(error.code).toBe("write_outcome_unknown");
    expect(error.recovery).toBe("retry");
    expect(error.fix).toMatch(/second point/);
  });
});
