/**
 * Stubs for exercising `WriteService` in isolation.
 *
 * `WriteService` reaches the network through exactly two seams on
 * `BaseConnectionService` — `getInfluxHttpClient()` for the Core/Enterprise and
 * Clustered HTTP paths, and `getClient()` for the Cloud SDK paths. Stubbing
 * both makes every branch of `writeLineProtocol` and its error handler
 * reachable without an InfluxDB instance.
 */

import { vi } from "vitest";
import { WriteService } from "../../src/services/write.service.js";
import { BaseConnectionService } from "../../src/services/base-connection.service.js";
import { InfluxProductType } from "../../src/helpers/enums/influx-product-types.enum.js";

export function stubBaseService(
  type: InfluxProductType,
): BaseConnectionService {
  return {
    validateDataCapabilities: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn(),
    getClient: vi.fn().mockReturnValue(null),
  } as unknown as BaseConnectionService;
}

/** An HTTP client whose `post` rejects with the given axios-shaped error. */
export function httpClientThrowing(error: unknown) {
  return { post: vi.fn().mockRejectedValue(error) };
}

/** An HTTP client whose `post` resolves, for asserting on the request made. */
export function httpClientRecording() {
  return { post: vi.fn().mockResolvedValue({ status: 204, data: "" }) };
}

/** An SDK client whose `write` rejects with the given `HttpError`-shaped error. */
export function sdkClientThrowing(error: unknown) {
  return {
    write: vi.fn().mockRejectedValue(error),
    queryPoints: vi.fn(),
    close: vi.fn(),
  };
}

/** An SDK client whose `write` resolves, for asserting on the call made. */
export function sdkClientRecording() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    queryPoints: vi.fn(),
    close: vi.fn(),
  };
}

/**
 * Build a `WriteService` wired to a throwing HTTP client for the given product
 * type, and return the message the model would see for a failed write.
 */
export async function writeErrorMessage(
  type: InfluxProductType,
  transport: { kind: "http" | "sdk"; error: unknown },
  lineProtocol = "m,t=a f=1i",
  database = "mydb",
): Promise<string> {
  const base = stubBaseService(type);
  if (transport.kind === "http") {
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(transport.error) as any,
    );
  } else {
    vi.mocked(base.getClient).mockReturnValue(
      sdkClientThrowing(transport.error) as any,
    );
  }

  const svc = new WriteService(base);
  try {
    await svc.writeLineProtocol(lineProtocol, database, {
      precision: "nanosecond",
    });
  } catch (error: any) {
    return String(error.message);
  }
  throw new Error("expected writeLineProtocol to reject, but it resolved");
}
