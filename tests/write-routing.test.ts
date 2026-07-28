/**
 * Write-path routing by product type.
 *
 * Establishes which endpoint and transport each product type uses to write.
 *
 * InfluxDB 3.11's release notes (Core/Enterprise-scoped) document a write
 * 400→503 change for a stopped node, on the **legacy v1/v2 write endpoint**
 * (`/api/v2/write`) that Core/Enterprise also expose for backward
 * compatibility. This server never calls that endpoint for Core/Enterprise —
 * it always uses `POST /api/v3/write_lp` — so the documented change does not
 * reach this server's Core/Enterprise write path. The separate `Clustered`
 * product (InfluxDB Clustered, the self-hosted sibling to Cloud Dedicated —
 * not a multi-node Enterprise deployment) also posts to `/api/v2/write`
 * below, but that's a separate, unrelated fact: `Clustered` is a different
 * product on its own release train, not covered by these Core/Enterprise
 * release notes at all. What v3 itself returns for a stopped node is
 * untested here — it needs a live instance with a node stopped mid-write.
 *
 * These are regression tests, not acceptance criteria: they assert what the
 * code does today and must keep doing. If one fails, the routing changed and
 * needs re-auditing against the 3.11 release notes.
 */

import { describe, it, expect, vi } from "vitest";
import { WriteService } from "../src/services/write.service.js";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import {
  stubBaseService,
  httpClientRecording,
  sdkClientRecording,
} from "./helpers/write-service.js";

const LINE = "m,t=a f=1i";

async function postFor(type: InfluxProductType, precision: any = "nanosecond") {
  const base = stubBaseService(type);
  const httpClient = httpClientRecording();
  vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);

  await new WriteService(base).writeLineProtocol(LINE, "mydb", { precision });

  const [url, body, config] = httpClient.post.mock.calls[0];
  return { url: String(url), body, config, httpClient };
}

async function sdkWriteFor(
  type: InfluxProductType,
  precision: any = "nanosecond",
) {
  const base = stubBaseService(type);
  const client = sdkClientRecording();
  vi.mocked(base.getClient).mockReturnValue(client as any);

  await new WriteService(base).writeLineProtocol(LINE, "mydb", { precision });

  return { call: client.write.mock.calls[0], client };
}

describe("write routing – Core and Enterprise use the v3 endpoint", () => {
  it.each([
    ["core", InfluxProductType.Core],
    ["enterprise", InfluxProductType.Enterprise],
  ])("%s posts to /api/v3/write_lp, never /api/v2/write", async (_l, type) => {
    const { url } = await postFor(type);

    expect(url).toMatch(/^\/api\/v3\/write_lp\?/);
    expect(url).not.toContain("/api/v2/write");
  });

  it("sends db, precision, accept_partial and no_sync as query parameters", async () => {
    const { url } = await postFor(InfluxProductType.Core);
    const params = new URLSearchParams(url.split("?")[1]);

    expect(params.get("db")).toBe("mydb");
    expect(params.get("precision")).toBe("nanosecond");
    expect(params.get("accept_partial")).toBe("true");
    expect(params.get("no_sync")).toBe("false");
  });

  it("defaults accept_partial to true, so partial-write bodies are reachable", async () => {
    // Because the server opts into partial writes, a rejection may arrive as
    // a partial-write body rather than a whole-batch refusal — see
    // `CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA` in write-error-core.test.ts,
    // which is exactly this shape.
    const { url } = await postFor(InfluxProductType.Core);

    expect(new URLSearchParams(url.split("?")[1]).get("accept_partial")).toBe(
      "true",
    );
  });

  it("uses the long-form precision name, unmapped", async () => {
    const { url } = await postFor(InfluxProductType.Core, "millisecond");

    expect(new URLSearchParams(url.split("?")[1]).get("precision")).toBe(
      "millisecond",
    );
  });

  it("sends line protocol as a text/plain body", async () => {
    const { body, config } = await postFor(InfluxProductType.Core);

    expect(body).toBe(LINE);
    expect(config.headers["Content-Type"]).toMatch(/^text\/plain/);
  });
});

describe("write routing – Clustered is the only v2 caller", () => {
  it("posts to /api/v2/write", async () => {
    const { url } = await postFor(InfluxProductType.Clustered);

    expect(url).toMatch(/^\/api\/v2\/write\?/);
  });

  it("sends bucket (not db) and a short precision code", async () => {
    const { url } = await postFor(InfluxProductType.Clustered, "millisecond");
    const params = new URLSearchParams(url.split("?")[1]);

    expect(params.get("bucket")).toBe("mydb");
    expect(params.get("db")).toBeNull();
    expect(params.get("precision")).toBe("ms");
  });
});

describe("write routing – Cloud product types use the SDK client", () => {
  it("cloud-dedicated calls client.write with the long-form precision", async () => {
    const { call } = await sdkWriteFor(
      InfluxProductType.CloudDedicated,
      "millisecond",
    );

    expect(call[0]).toBe(LINE);
    expect(call[1]).toBe("mydb");
    expect(call[3]).toEqual({ precision: "millisecond" });
  });

  it("cloud-serverless calls client.write with a short precision code", async () => {
    const { call } = await sdkWriteFor(
      InfluxProductType.CloudServerless,
      "millisecond",
    );

    expect(call[0]).toBe(LINE);
    expect(call[1]).toBe("mydb");
    expect(call[3]).toEqual({ precision: "ms" });
  });

  it.each([
    ["cloud-dedicated", InfluxProductType.CloudDedicated],
    ["cloud-serverless", InfluxProductType.CloudServerless],
  ])("%s makes no HTTP write request", async (_l, type) => {
    const base = stubBaseService(type);
    const httpClient = httpClientRecording();
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(httpClient as any);
    vi.mocked(base.getClient).mockReturnValue(sdkClientRecording() as any);

    await new WriteService(base).writeLineProtocol(LINE, "mydb", {
      precision: "nanosecond",
    });

    expect(httpClient.post).not.toHaveBeenCalled();
  });
});

describe("write routing – unknown product type", () => {
  it("rejects rather than defaulting to a transport", async () => {
    const base = stubBaseService("something-else" as InfluxProductType);

    await expect(
      new WriteService(base).writeLineProtocol(LINE, "mydb", {
        precision: "nanosecond",
      }),
    ).rejects.toThrow(/Unsupported InfluxDB product type/);
  });
});
