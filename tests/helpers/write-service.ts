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

export function httpClientThrowing(error: unknown) {
  return { post: vi.fn().mockRejectedValue(error) };
}

export function httpClientRecording() {
  return { post: vi.fn().mockResolvedValue({ status: 204, data: "" }) };
}

export function sdkClientThrowing(error: unknown) {
  return {
    write: vi.fn().mockRejectedValue(error),
    queryPoints: vi.fn(),
    close: vi.fn(),
  };
}

export function sdkClientRecording() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    queryPoints: vi.fn(),
    close: vi.fn(),
  };
}

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
