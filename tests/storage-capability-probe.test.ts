/**
 * Capability probe — does this instance run the PachaTree storage engine?
 *
 * Seam: `probeStorageCapability(deps, database)`. Everything below the seam is
 * faked; the real `ping()` and `executeQuery()` shapes are pinned by
 * `base-connection-ping.test.ts` and `query-routing.test.ts`.
 *
 * Error strings are verbatim from InfluxDB 3.11.2 (Enterprise :8181,
 * Core :8282), captured 2026-09-02. See `.docs/mcp-3.11/verification-questions.md`
 * §3 (C5) for the 3.11.0 GA equivalents.
 */

import { describe, it, expect, vi } from "vitest";
import {
  probeStorageCapability,
  type StorageProbeDeps,
} from "../src/services/storage-capability.service.js";

/** Verbatim 3.11.2 Core response to `SELECT 1 FROM system.pt_shards LIMIT 1`. */
const TABLE_NOT_FOUND =
  "Error during planning: table 'public.system.pt_shards' not found";

function deps(overrides: Partial<StorageProbeDeps> = {}): StorageProbeDeps {
  return {
    ping: vi.fn().mockResolvedValue({ ok: true, version: "3.11.2" }),
    executeQuery: vi.fn().mockResolvedValue([{ "Int64(1)": 1 }]),
    ...overrides,
  };
}

describe("probeStorageCapability", () => {
  it("reports PachaTree when the system.pt_shards probe query succeeds", async () => {
    const capability = await probeStorageCapability(deps(), "home");

    expect(capability).toEqual({ pachaTree: true, version: "3.11.2" });
  });

  it("reports no PachaTree when the probe query is rejected, as on Core", async () => {
    const capability = await probeStorageCapability(
      deps({
        ping: vi.fn().mockResolvedValue({ ok: true, version: "3.11.2" }),
        executeQuery: vi.fn().mockRejectedValue(new Error(TABLE_NOT_FOUND)),
      }),
      "home",
    );

    expect(capability).toEqual({ pachaTree: false, version: "3.11.2" });
  });

  // B1: unauthenticated `/ping` omits `x-influxdb-version` entirely, so `version`
  // is absent rather than empty. A probe that cannot reach the instance reports
  // no capability instead of throwing — a failed probe must never block startup.
  it("fails closed and skips the query when ping throws", async () => {
    const executeQuery = vi.fn();

    const capability = await probeStorageCapability(
      deps({
        ping: vi.fn().mockRejectedValue(new Error("fetch failed")),
        executeQuery,
      }),
      "home",
    );

    expect(capability).toEqual({ pachaTree: false });
    expect(executeQuery).not.toHaveBeenCalled();
  });

  // The real `ping()` resolves `{ ok: false, message }` rather than throwing —
  // see `base-connection.service.ts`. A 401 lands here, not in the catch above.
  it("fails closed and skips the query when ping reports not ok", async () => {
    const executeQuery = vi.fn();

    const capability = await probeStorageCapability(
      deps({
        ping: vi.fn().mockResolvedValue({
          ok: false,
          message: "Ping failed with status 401",
        }),
        executeQuery,
      }),
      "home",
    );

    expect(capability).toEqual({ pachaTree: false });
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
