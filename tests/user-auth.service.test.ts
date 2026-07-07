import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UserAuthService } from "../src/services/user-auth.service.js";

const URL = "http://localhost:8181";

function authBody(overrides: Record<string, unknown> = {}) {
  return {
    token: "jwt-1",
    refreshToken: "refresh-1",
    userId: 42,
    // expiresAt is epoch SECONDS (one hour out by default)
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeService(post: ReturnType<typeof vi.fn>) {
  return new UserAuthService(URL, "alice", "pw", { post } as any);
}

describe("UserAuthService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs in on first getToken", async () => {
    const post = vi.fn().mockResolvedValue({ data: authBody() });
    const svc = makeService(post);
    expect(await svc.getToken()).toBe("jwt-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/v3/authorize", {
      username: "alice",
      password: "pw",
    });
  });

  it("reuses a fresh token without another request", async () => {
    const post = vi.fn().mockResolvedValue({ data: authBody() });
    const svc = makeService(post);
    await svc.getToken();
    await svc.getToken();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("refreshes proactively when within the expiry skew", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: authBody({
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        }),
      })
      .mockResolvedValueOnce({
        data: authBody({ token: "jwt-2", refreshToken: "refresh-2" }),
      });
    const svc = makeService(post);
    await svc.getToken();
    // 45s later: 15s to expiry, inside the 30s skew margin
    vi.advanceTimersByTime(45_000);
    expect(await svc.getToken()).toBe("jwt-2");
    expect(post).toHaveBeenNthCalledWith(2, "/api/v3/authorize/refresh", {
      refreshToken: "refresh-1",
    });
  });

  it("coalesces concurrent getToken calls into one request", async () => {
    let release!: (v: any) => void;
    const post = vi
      .fn()
      .mockReturnValue(new Promise((resolve) => (release = resolve)));
    const svc = makeService(post);
    const [a, b] = [svc.getToken(), svc.getToken()];
    release({ data: authBody() });
    expect(await a).toBe("jwt-1");
    expect(await b).toBe("jwt-1");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("falls back to re-login when refresh is rejected with 401", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: authBody({ expiresAt: Math.floor(Date.now() / 1000) + 60 }),
      })
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: authBody({ token: "jwt-3" }) });
    const svc = makeService(post);
    await svc.getToken();
    vi.advanceTimersByTime(45_000);
    expect(await svc.getToken()).toBe("jwt-3");
    expect(post).toHaveBeenNthCalledWith(3, "/api/v3/authorize", {
      username: "alice",
      password: "pw",
    });
  });

  it("forceRefresh fetches a new token even when fresh, and bumps the version", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: authBody() })
      .mockResolvedValueOnce({
        data: authBody({ token: "jwt-2", refreshToken: "refresh-2" }),
      });
    const svc = makeService(post);
    await svc.getToken();
    const v1 = svc.getTokenVersion();
    expect(await svc.forceRefresh()).toBe("jwt-2");
    expect(svc.getTokenVersion()).toBe(v1 + 1);
  });

  it("produces curated errors without credential material", async () => {
    const post = vi.fn().mockRejectedValue({ response: { status: 401 } });
    const svc = makeService(post);
    const err = await svc.getToken().catch((e) => e);
    expect(err.message).toContain("alice");
    expect(err.message).toContain(URL);
    expect(err.message).toContain("401");
    expect(err.message).not.toContain("pw");
  });

  it("hints at JWT config on 503 (users not enabled or JWT signing missing)", async () => {
    const post = vi.fn().mockRejectedValue({ response: { status: 503 } });
    const svc = makeService(post);
    await expect(svc.getToken()).rejects.toThrow(/not enabled|jwt/i);
  });

  it("hints at missing endpoint support on 404", async () => {
    const post = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const svc = makeService(post);
    await expect(svc.getToken()).rejects.toThrow(
      /not support user authentication/,
    );
  });

  it("exposes auth info without token material", async () => {
    const post = vi.fn().mockResolvedValue({ data: authBody() });
    const svc = makeService(post);
    await svc.getToken();
    const info = svc.getAuthInfo();
    expect(info.username).toBe("alice");
    expect(info.userId).toBe(42);
    expect(JSON.stringify(info)).not.toContain("jwt-1");
    expect(JSON.stringify(info)).not.toContain("refresh-1");
  });
});
