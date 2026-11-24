import http from "node:http";
import net from "node:net";
import axios from "axios";
import { InfluxDBClient } from "@influxdata/influxdb3-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveOperationError,
  resolveWriteError,
} from "../src/services/error-resolution.service.js";

const LINE_WITHOUT_TIMESTAMP = "m,host=a v=1";
const LINE_WITH_TIMESTAMP = "m,host=a v=1 1700000000000000000";
const CLIENT_TIMEOUT_MS = 200;
const RETRY_AFTER_SECONDS = 7;

let serverThatNeverReplies: net.Server;
let serverThatAsksForALaterRetry: http.Server;
let silentUrl: string;
let busyUrl: string;

async function listen(server: net.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  serverThatNeverReplies = net.createServer((socket) => socket.resume());
  serverThatAsksForALaterRetry = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": String(RETRY_AFTER_SECONDS),
      });
      response.end('{"error":"service unavailable"}');
    });
  });
  silentUrl = await listen(serverThatNeverReplies);
  busyUrl = await listen(serverThatAsksForALaterRetry);
});

afterAll(() => {
  serverThatNeverReplies.close();
  serverThatAsksForALaterRetry.close();
});

async function failureOf(write: () => Promise<unknown>): Promise<unknown> {
  try {
    await write();
  } catch (error) {
    return error;
  }
  throw new Error("the write succeeded");
}

function axiosWrite(baseUrl: string, line: string) {
  return failureOf(() =>
    axios.post(`${baseUrl}/api/v3/write_lp?db=db`, line, {
      proxy: false,
      timeout: CLIENT_TIMEOUT_MS,
    }),
  );
}

function clientLibraryWrite(baseUrl: string, line: string) {
  return failureOf(async () => {
    const client = new InfluxDBClient({
      host: baseUrl,
      token: "token",
      database: "db",
      timeout: CLIENT_TIMEOUT_MS,
    });
    try {
      await client.write(line);
    } finally {
      await client.close();
    }
  });
}

const TRANSPORTS = [
  ["axios (core, enterprise, clustered)", axiosWrite],
  [
    "the client library (cloud-dedicated, cloud-serverless)",
    clientLibraryWrite,
  ],
] as const;

describe("a write the client stops waiting for", () => {
  it.each(TRANSPORTS)(
    "leaves the outcome unknown through %s",
    async (_transport, write) => {
      const error = resolveWriteError(
        await write(silentUrl, LINE_WITHOUT_TIMESTAMP),
        "db",
        { lineProtocol: LINE_WITHOUT_TIMESTAMP, acceptPartial: true },
      );
      expect(error.code).toBe("write_outcome_unknown");
      expect(error.recovery).toBe("none");
      expect(error.fix).toMatch(/stopped waiting/);
      expect(error.fix).toMatch(/second point/);
    },
  );

  it.each(TRANSPORTS)(
    "allows a resend when every line has a timestamp, through %s",
    async (_transport, write) => {
      const error = resolveWriteError(
        await write(silentUrl, LINE_WITH_TIMESTAMP),
        "db",
        { lineProtocol: LINE_WITH_TIMESTAMP, acceptPartial: true },
      );
      expect(error.code).toBe("write_outcome_unknown");
      expect(error.recovery).toBe("retry");
    },
  );
});

describe("a 503 with Retry-After", () => {
  it.each(TRANSPORTS)(
    "reports retry_after_ms on the write path through %s",
    async (_transport, write) => {
      const error = resolveWriteError(
        await write(busyUrl, LINE_WITHOUT_TIMESTAMP),
        "db",
        { lineProtocol: LINE_WITHOUT_TIMESTAMP, acceptPartial: true },
      );
      expect(error.code).toBe("write_unavailable");
      expect(error.retry_after_ms).toBe(RETRY_AFTER_SECONDS * 1000);
    },
  );

  it.each(TRANSPORTS)(
    "reports retry_after_ms on the shared path through %s",
    async (_transport, write) => {
      const error = resolveOperationError(
        await write(busyUrl, LINE_WITHOUT_TIMESTAMP),
      );
      expect(error.retry_after_ms).toBe(RETRY_AFTER_SECONDS * 1000);
    },
  );
});
