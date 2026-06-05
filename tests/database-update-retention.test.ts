import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseManagementService } from "../src/services/database-management.service.js";
import { BaseConnectionService } from "../src/services/base-connection.service.js";

// Retention periods are passed to the tool in nanoseconds.
const HOUR_NS = 3_600_000_000_000;
const DAY_NS = 24 * HOUR_NS;

function stubBaseService(type = "core"): BaseConnectionService {
  return {
    validateManagementCapabilities: vi.fn(),
    validateOperationSupport: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn(),
  } as unknown as BaseConnectionService;
}

function serviceWithPut(base: BaseConnectionService) {
  const put = vi.fn().mockResolvedValue(undefined);
  vi.mocked(base.getInfluxHttpClient).mockReturnValue({ put } as any);
  return { svc: new DatabaseManagementService(base), put };
}

describe("updateDatabase – Core/Enterprise retention", () => {
  afterEach(() => vi.restoreAllMocks());

  it("PUTs /api/v3/configure/database with retention_period as a duration string", async () => {
    const base = stubBaseService("core");
    const { svc, put } = serviceWithPut(base);

    await svc.updateDatabase("mydb", { retentionPeriod: 7 * DAY_NS });

    expect(put).toHaveBeenCalledWith("/api/v3/configure/database", {
      db: "mydb",
      retention_period: "7d",
    });
  });

  it("emits whole days when evenly divisible", async () => {
    const base = stubBaseService("enterprise");
    const { svc, put } = serviceWithPut(base);

    await svc.updateDatabase("mydb", { retentionPeriod: 60 * DAY_NS });

    expect(put.mock.calls[0][1].retention_period).toBe("60d");
  });

  it("does not round a 1-hour retention down to 0d (regression)", async () => {
    const base = stubBaseService("core");
    const { svc, put } = serviceWithPut(base);

    await svc.updateDatabase("mydb", { retentionPeriod: HOUR_NS });

    expect(put.mock.calls[0][1].retention_period).toBe("1h");
  });

  it("falls back to whole hours for sub-day, non-day-divisible periods", async () => {
    const base = stubBaseService("core");
    const { svc, put } = serviceWithPut(base);

    // 90 minutes -> floors to 1h (never 0d)
    await svc.updateDatabase("mydb", {
      retentionPeriod: 90 * 60 * 1_000_000_000,
    });

    expect(put.mock.calls[0][1].retention_period).toBe("1h");
  });

  it("rejects retention periods shorter than one hour", async () => {
    const base = stubBaseService("core");
    const { svc } = serviceWithPut(base);

    await expect(
      svc.updateDatabase("mydb", { retentionPeriod: 30 * 60 * 1_000_000_000 }),
    ).rejects.toThrow(/at least 1 hour/);
  });

  it("rejects when no retentionPeriod is provided", async () => {
    const base = stubBaseService("core");
    const { svc, put } = serviceWithPut(base);

    await expect(svc.updateDatabase("mydb", {})).rejects.toThrow(
      /No valid configuration parameters/,
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("warns about unsupported params but still applies retention", async () => {
    const base = stubBaseService("core");
    const { svc, put } = serviceWithPut(base);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await svc.updateDatabase("mydb", {
      retentionPeriod: 7 * DAY_NS,
      maxTables: 5,
    });

    expect(warn).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][1].retention_period).toBe("7d");
  });

  it("allows update_database for all five product types", async () => {
    const base = stubBaseService("core");
    const { svc } = serviceWithPut(base);

    await svc.updateDatabase("mydb", { retentionPeriod: 7 * DAY_NS });

    const [operation, supported] = vi.mocked(base.validateOperationSupport).mock
      .calls[0];
    expect(operation).toBe("update_database");
    expect(supported).toEqual(
      expect.arrayContaining([
        "cloud-dedicated",
        "cloud-serverless",
        "clustered",
        "core",
        "enterprise",
      ]),
    );
  });
});
