import { describe, expect, it, vi } from "vitest";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { TokenManagementService } from "../src/services/token-management.service.js";

function stubBaseService(type: "core" | "enterprise") {
  const post = vi.fn().mockResolvedValue({ token: "secret", id: "42" });
  const base = {
    validateManagementCapabilities: vi.fn(),
    validateOperationSupport: vi.fn(),
    getConnectionInfo: vi.fn().mockReturnValue({ type }),
    getInfluxHttpClient: vi.fn().mockReturnValue({ post }),
  } as unknown as BaseConnectionService;

  return { base, post, service: new TokenManagementService(base) };
}

describe("TokenManagementService 3.11.5 contracts", () => {
  it("sends token_name and expiry_secs to named_admin", async () => {
    const { service, post } = stubBaseService("core");

    await service.createAdminToken("backup-admin", 3600);

    expect(post).toHaveBeenCalledWith("/api/v3/configure/token/named_admin", {
      token_name: "backup-admin",
      expiry_secs: 3600,
    });
  });

  it("limits resource-token creation to Enterprise", async () => {
    const { base, service } = stubBaseService("enterprise");

    await service.createResourceToken("reader", [
      {
        resource_type: "db",
        resource_names: ["metrics"],
        actions: ["read"],
      },
    ]);

    expect(base.validateOperationSupport).toHaveBeenCalledWith(
      "create_resource_token",
      ["enterprise"],
    );
  });
});
