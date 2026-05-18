import { describe, it, expect, vi } from "vitest";
import { QueryService } from "../src/services/query.service.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import {
  AxiosErrorShape,
  CORE_404_NONEXISTENT_DB,
  CORE_400_BAD_WRITE,
  CORE_500_INVALID_SQL,
} from "./fixtures/error-responses.js";

function stubBaseService(): BaseConnectionService {
  return {
    validateDataCapabilities: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type: "core" }),
    getInfluxHttpClient: vi.fn(),
    getClient: vi.fn().mockReturnValue(null),
  } as unknown as BaseConnectionService;
}

function httpClientThrowing(error: AxiosErrorShape) {
  return { post: vi.fn().mockRejectedValue(error) };
}

describe("handleQueryError – Core (axios) error path", () => {
  it("404: surfaces InfluxDB error from JSON {error:...} response", async () => {
    const base = stubBaseService();
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(CORE_404_NONEXISTENT_DB) as any,
    );
    const svc = new QueryService(base);

    await expect(
      svc.executeQuery("SELECT 1", "nonexistent"),
    ).rejects.toThrow(
      /^Database not found: query error: database not found: nonexistent$/,
    );
  });

  it("400: surfaces InfluxDB error from JSON {error:...} response", async () => {
    const base = stubBaseService();
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(CORE_400_BAD_WRITE) as any,
    );
    const svc = new QueryService(base);

    await expect(
      svc.executeQuery("SELECT 1", "mydb"),
    ).rejects.toThrow(
      /^Bad request: partial write of line protocol occurred$/,
    );
  });

  it("500: surfaces plain-text error body", async () => {
    const base = stubBaseService();
    vi.mocked(base.getInfluxHttpClient).mockReturnValue(
      httpClientThrowing(CORE_500_INVALID_SQL) as any,
    );
    const svc = new QueryService(base);

    await expect(
      svc.executeQuery("THIS IS NOT SQL", "mydb"),
    ).rejects.toThrow(/^Query failed:.*ParserError.*Expected: an SQL statement/);
  });
});
