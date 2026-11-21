import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";
import { URL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InfluxDBClient } from "@influxdata/influxdb3-client";
import { WriteService, type Precision } from "../src/services/write.service.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { stubBaseService } from "./helpers/write-service.js";

let server: Server;
let url: string;
const receivedWriteUrls: string[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    receivedWriteUrls.push(req.url ?? "");
    req.resume();
    req.on("end", () => {
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("SDK write paths with the real client library", () => {
  it.each([
    [InfluxProductType.CloudDedicated, "second", "s"],
    [InfluxProductType.CloudDedicated, "nanosecond", "ns"],
    [InfluxProductType.CloudServerless, "millisecond", "ms"],
  ] as const)(
    "%s sends a %s write that the library accepts",
    async (type, precision: Precision, wirePrecision) => {
      const base = stubBaseService(type);
      const client = new InfluxDBClient({ host: url, token: "test-token" });
      vi.mocked(base.getClient).mockReturnValue(client);
      receivedWriteUrls.length = 0;

      await new WriteService(base).writeLineProtocol("m v=1 1", "mydb", {
        precision,
      });

      expect(receivedWriteUrls).toHaveLength(1);
      const sent = new URL(receivedWriteUrls[0], url);
      expect(sent.pathname).toBe("/api/v2/write");
      expect(sent.searchParams.get("bucket")).toBe("mydb");
      expect(sent.searchParams.get("precision")).toBe(wirePrecision);
      await client.close();
    },
  );
});
