# Enterprise User-Based Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The MCP server can authenticate to InfluxDB 3 Enterprise as a user with `INFLUX_DB_USERNAME`/`INFLUX_DB_PASSWORD`, transparently managing JWT login, proactive refresh, and re-login. Zero new MCP tools.

**Architecture:** A new `UserAuthService` is the single owner of auth state (lazy login via `POST /api/v3/authorize`, proactive refresh 30s before expiry, rotating refresh tokens, re-login fallback). `HttpClientService` gains an async token provider and a one-shot 401 retry. `BaseConnectionService.getClient()` becomes async and rebuilds the SDK client when the token rotates. Capability checks accept credential-backed auth so tools reach the login flow.

**Tech Stack:** TypeScript (strict, ES2022, ESM with `.js` import suffixes), axios, `@influxdata/influxdb3-client`, vitest. All logging to stderr. Spec: `docs/superpowers/specs/2026-06-10-enterprise-user-auth-design.md`.

**Verified wire contract** (from influxdb_pro server source; camelCase JSON):

- `POST /api/v3/authorize` `{username, password}` → `{token, refreshToken, userId, expiresAt}`; `expiresAt` is epoch **seconds**; TTL 3600s.
- `POST /api/v3/authorize/refresh` `{refreshToken}` → same shape; the old refresh token is consumed.

**Build/test commands:** `npm run build` (required before protocol tests — they spawn `build/index.js`), `npm test`, `npm run lint`, `npx prettier --check .`

---

### Task 1: Config — credential fields and validation matrix

**Files:**

- Modify: `src/config.ts`
- Create: `tests/config-user-auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/config-user-auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateConfig, McpServerConfig } from "../src/config.js";

function makeConfig(
  influx: Partial<McpServerConfig["influx"]>,
): McpServerConfig {
  return {
    influx: { type: "enterprise", ...influx },
    server: { name: "influxdb-mcp-server", version: "0.0.0" },
  };
}

describe("validateConfig user auth", () => {
  it("accepts enterprise with token only", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", token: "t" })),
    ).not.toThrow();
  });

  it("accepts enterprise with username and password only", () => {
    expect(() =>
      validateConfig(
        makeConfig({ url: "http://x:8181", username: "alice", password: "pw" }),
      ),
    ).not.toThrow();
  });

  it("rejects enterprise with both token and credentials", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          url: "http://x:8181",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/Set exactly one/);
  });

  it("rejects enterprise with username but no password", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", username: "alice" })),
    ).toThrow(/INFLUX_DB_PASSWORD is required/);
  });

  it("rejects enterprise with password but no username", () => {
    expect(() =>
      validateConfig(makeConfig({ url: "http://x:8181", password: "pw" })),
    ).toThrow(/INFLUX_DB_USERNAME is required/);
  });

  it("rejects enterprise with neither token nor credentials, naming both options", () => {
    expect(() => validateConfig(makeConfig({ url: "http://x:8181" }))).toThrow(
      /INFLUX_DB_TOKEN.*INFLUX_DB_USERNAME/s,
    );
  });

  it("rejects credentials for core", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          type: "core",
          url: "http://x:8181",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/only supported.*enterprise/i);
  });

  it("rejects credentials for cloud-serverless", () => {
    expect(() =>
      validateConfig(
        makeConfig({
          type: "cloud-serverless",
          url: "http://x",
          token: "t",
          username: "alice",
          password: "pw",
        }),
      ),
    ).toThrow(/only supported.*enterprise/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config-user-auth.test.ts`
Expected: FAIL — TypeScript/property errors or assertion failures (`username` not in `InfluxConfig`, validation not implemented).

- [ ] **Step 3: Implement config changes**

In `src/config.ts`:

Add to `InfluxConfig` (after `management_token`):

```typescript
export interface InfluxConfig {
  url?: string;
  token?: string;
  management_token?: string;
  username?: string;
  password?: string;
  type: string;
  account_id?: string;
  cluster_id?: string;
}
```

In `loadConfig()`, add after `management_token`:

```typescript
      username: process.env.INFLUX_DB_USERNAME || undefined,
      password: process.env.INFLUX_DB_PASSWORD || undefined,
```

In `validateConfig()`, add right after the product-type check (before the cloud-dedicated branch):

```typescript
const hasCredentialInput = !!(config.influx.username || config.influx.password);
if (hasCredentialInput && config.influx.type !== InfluxProductType.Enterprise) {
  errors.push(
    "INFLUX_DB_USERNAME/INFLUX_DB_PASSWORD are only supported for INFLUX_DB_PRODUCT_TYPE=enterprise. Use INFLUX_DB_TOKEN instead.",
  );
}
```

Replace the final core/enterprise branch (the `else if ([Enterprise, Core].includes(...)` block) with:

```typescript
  } else if (
    [InfluxProductType.Enterprise, InfluxProductType.Core].includes(
      config.influx.type as InfluxProductType,
    )
  ) {
    if (!config.influx.url) {
      errors.push("INFLUX_DB_INSTANCE_URL is required for core/enterprise");
    }
    const hasToken = !!config.influx.token;
    const hasFullCredentials = !!(
      config.influx.username && config.influx.password
    );
    if (config.influx.type === InfluxProductType.Enterprise) {
      if (hasToken && hasCredentialInput) {
        errors.push(
          "Both INFLUX_DB_TOKEN and INFLUX_DB_USERNAME/INFLUX_DB_PASSWORD are set. Set exactly one authentication method.",
        );
      } else if (hasCredentialInput && !hasFullCredentials) {
        errors.push(
          config.influx.username
            ? "INFLUX_DB_PASSWORD is required when INFLUX_DB_USERNAME is set"
            : "INFLUX_DB_USERNAME is required when INFLUX_DB_PASSWORD is set",
        );
      } else if (!hasToken && !hasCredentialInput) {
        errors.push(
          "INFLUX_DB_TOKEN, or INFLUX_DB_USERNAME and INFLUX_DB_PASSWORD, is required for enterprise",
        );
      }
    } else if (!hasToken) {
      errors.push("INFLUX_DB_TOKEN is required for core/enterprise");
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config-user-auth.test.ts`
Expected: 8 passed.

Also run the existing suite to catch regressions: `npm run build && npm test`
Expected: all pass (25 passed, 6 skipped, plus the 8 new).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config-user-auth.test.ts
git commit -m "feat: accept INFLUX_DB_USERNAME/PASSWORD for enterprise config"
```

---

### Task 2: UserAuthService — token lifecycle

**Files:**

- Create: `src/services/user-auth.service.ts`
- Create: `tests/user-auth.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/user-auth.service.test.ts`:

```typescript
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
        data: authBody({ expiresAt: Math.floor(Date.now() / 1000) + 60 }),
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

  it("hints at server support on 404", async () => {
    const post = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const svc = makeService(post);
    await expect(svc.getToken()).rejects.toThrow(
      /not support user authentication|not enabled/,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/user-auth.service.test.ts`
Expected: FAIL — cannot resolve `../src/services/user-auth.service.js`.

- [ ] **Step 3: Implement UserAuthService**

Create `src/services/user-auth.service.ts`:

```typescript
/**
 * User Auth Service
 *
 * Owns the Enterprise user-auth token lifecycle: lazy login with
 * username/password (POST /api/v3/authorize), proactive refresh before
 * expiry (POST /api/v3/authorize/refresh, rotating refresh token), and
 * re-login when the refresh token is rejected. Tokens live in memory only.
 */

import axios from "axios";

export interface TokenProvider {
  getToken(): Promise<string>;
  forceRefresh(): Promise<string>;
}

export interface UserAuthInfo {
  username: string;
  userId?: number;
  expiresAt?: number; // epoch seconds
}

interface AuthorizeResponse {
  token: string;
  refreshToken: string;
  userId: number;
  expiresAt: number; // epoch seconds
}

interface AuthHttp {
  post(url: string, data?: unknown): Promise<{ data: AuthorizeResponse }>;
}

// Refresh this long before the access token expires.
const EXPIRY_SKEW_MS = 30_000;

export class UserAuthService implements TokenProvider {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAtMs = 0;
  private userId?: number;
  private tokenVersion = 0;
  private inFlight: Promise<string> | null = null;
  private http: AuthHttp;

  constructor(
    private url: string,
    private username: string,
    private password: string,
    http?: AuthHttp,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: url.replace(/\/$/, ""),
        timeout: 30000,
        headers: { "Content-Type": "application/json" },
      });
  }

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAtMs - EXPIRY_SKEW_MS) {
      return this.accessToken;
    }
    return this.authenticate();
  }

  async forceRefresh(): Promise<string> {
    this.accessToken = null;
    return this.authenticate();
  }

  getTokenVersion(): number {
    return this.tokenVersion;
  }

  getAuthInfo(): UserAuthInfo {
    return {
      username: this.username,
      userId: this.userId,
      expiresAt: this.expiresAtMs
        ? Math.floor(this.expiresAtMs / 1000)
        : undefined,
    };
  }

  private authenticate(): Promise<string> {
    if (!this.inFlight) {
      this.inFlight = this.doAuthenticate().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async doAuthenticate(): Promise<string> {
    if (this.refreshToken) {
      try {
        const response = await this.http.post("/api/v3/authorize/refresh", {
          refreshToken: this.refreshToken,
        });
        return this.applyResponse(response.data);
      } catch (error: any) {
        const status = error?.response?.status;
        if (status !== 401 && status !== 403) {
          throw this.authError(error, "Token refresh");
        }
        // Refresh token rejected: fall through to a full re-login.
        this.refreshToken = null;
      }
    }
    try {
      const response = await this.http.post("/api/v3/authorize", {
        username: this.username,
        password: this.password,
      });
      return this.applyResponse(response.data);
    } catch (error: any) {
      throw this.authError(error, "User authentication");
    }
  }

  private applyResponse(data: AuthorizeResponse): string {
    this.accessToken = data.token;
    this.refreshToken = data.refreshToken;
    this.expiresAtMs = data.expiresAt * 1000;
    this.userId = data.userId;
    this.tokenVersion++;
    return this.accessToken;
  }

  // Build a curated error. Never rethrow the raw axios error: it embeds
  // the request config, and with it the credential material.
  private authError(error: any, operation: string): Error {
    const status = error?.response?.status;
    let detail: string;
    if (status === 401) {
      detail = "401 Unauthorized (check username and password)";
    } else if (status === 404) {
      detail =
        "404 Not Found (the server may not support user authentication, or it is not enabled)";
    } else if (status) {
      detail = `HTTP ${status}`;
    } else {
      detail = error?.code || "request failed";
    }
    return new Error(
      `${operation} failed for user '${this.username}' at ${this.url}: ${detail}`,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/user-auth.service.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/user-auth.service.ts tests/user-auth.service.test.ts
git commit -m "feat: add UserAuthService for enterprise user-auth token lifecycle"
```

---

### Task 3: HttpClientService — token provider and 401 retry

**Files:**

- Modify: `src/services/http-client.service.ts`
- Create: `tests/http-client-auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/http-client-auth.test.ts`. These tests replace the axios adapter (the function axios calls to perform the actual I/O) with a fake, so no network is involved:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HttpClientService } from "../src/services/http-client.service.js";
import type { TokenProvider } from "../src/services/user-auth.service.js";

function makeProvider(tokens: string[]): TokenProvider & {
  forceRefreshCalls: number;
} {
  let i = 0;
  const provider = {
    forceRefreshCalls: 0,
    async getToken() {
      return tokens[Math.min(i, tokens.length - 1)];
    },
    async forceRefresh() {
      provider.forceRefreshCalls++;
      i++;
      return tokens[Math.min(i, tokens.length - 1)];
    },
  };
  return provider;
}

function installAdapter(
  client: HttpClientService,
  handler: (config: any) => { status: number; data: any },
) {
  const calls: any[] = [];
  client.getAxiosInstance().defaults.adapter = async (config: any) => {
    calls.push(config);
    const { status, data } = handler(config);
    const response = {
      status,
      statusText: String(status),
      data,
      headers: {},
      config,
    };
    if (status >= 400) {
      const error: any = new Error(`Request failed with status ${status}`);
      error.response = response;
      error.config = config;
      throw error;
    }
    return response;
  };
  return calls;
}

describe("HttpClientService with token provider", () => {
  it("sets Authorization from the provider on each request", async () => {
    const provider = makeProvider(["tok-1"]);
    const client = new HttpClientService(
      "http://x:8181",
      undefined,
      "enterprise",
      provider,
    );
    const calls = installAdapter(client, () => ({ status: 200, data: {} }));
    await client.get("/whatever");
    expect(calls[0].headers["Authorization"]).toBe("Bearer tok-1");
  });

  it("retries once with a refreshed token on 401", async () => {
    const provider = makeProvider(["expired", "fresh"]);
    const client = new HttpClientService(
      "http://x:8181",
      undefined,
      "enterprise",
      provider,
    );
    const calls = installAdapter(client, (config) =>
      config.headers["Authorization"] === "Bearer fresh"
        ? { status: 200, data: { ok: true } }
        : { status: 401, data: {} },
    );
    const result = await client.get("/whatever");
    expect(result).toEqual({ ok: true });
    expect(provider.forceRefreshCalls).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("does not retry more than once on persistent 401", async () => {
    const provider = makeProvider(["bad", "still-bad"]);
    const client = new HttpClientService(
      "http://x:8181",
      undefined,
      "enterprise",
      provider,
    );
    const calls = installAdapter(client, () => ({ status: 401, data: {} }));
    await expect(client.get("/whatever")).rejects.toThrow();
    expect(provider.forceRefreshCalls).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("leaves static-token behavior unchanged when no provider is given", async () => {
    const client = new HttpClientService("http://x:8181", "static-tok", "core");
    const calls = installAdapter(client, () => ({ status: 200, data: {} }));
    await client.get("/whatever");
    expect(calls[0].headers["Authorization"]).toBe("Bearer static-tok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/http-client-auth.test.ts`
Expected: FAIL — constructor does not accept a fourth argument / no Authorization header set.

- [ ] **Step 3: Implement provider support**

In `src/services/http-client.service.ts`:

Add import at the top:

```typescript
import { TokenProvider } from "./user-auth.service.js";
```

Replace the constructor with:

```typescript
  constructor(
    baseURL?: string,
    token?: string,
    influxType?: string,
    tokenProvider?: TokenProvider,
  ) {
    const axiosConfig: any = {
      baseURL: baseURL?.replace(/\/$/, ""),
      timeout: 30000,
      headers: this.createAuthHeaders(token, influxType),
    };

    if (influxType === InfluxProductType.Clustered) {
      axiosConfig.httpsAgent = new Agent({
        rejectUnauthorized: false,
      });
    }

    this.axiosInstance = axios.create(axiosConfig);

    if (tokenProvider) {
      this.axiosInstance.interceptors.request.use(async (config: any) => {
        config.headers = config.headers ?? {};
        config.headers["Authorization"] =
          `Bearer ${await tokenProvider.getToken()}`;
        return config;
      });
      this.axiosInstance.interceptors.response.use(
        (response: any) => response,
        async (error: any) => {
          const config = error?.config;
          if (error?.response?.status === 401 && config && !config._authRetried) {
            config._authRetried = true;
            config.headers["Authorization"] =
              `Bearer ${await tokenProvider.forceRefresh()}`;
            return this.axiosInstance.request(config);
          }
          return Promise.reject(error);
        },
      );
    }

    this.axiosInstance.interceptors.response.use(
      (response: any) => {
        return response;
      },
      (error: any) => {
        return Promise.reject(error);
      },
    );
  }
```

Update the static factory at the bottom of the class:

```typescript
  static createInfluxClient(
    baseUrl: string,
    token: string,
    influxType?: string,
    tokenProvider?: TokenProvider,
  ): HttpClientService {
    return new HttpClientService(baseUrl, token, influxType, tokenProvider);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-client-auth.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/http-client.service.ts tests/http-client-auth.test.ts
git commit -m "feat: support async token provider and 401 retry in HTTP client"
```

---

### Task 4: BaseConnectionService — capability checks, user-auth wiring, async getClient

**Files:**

- Modify: `src/services/base-connection.service.ts`
- Modify: `src/services/query.service.ts` (lines ~121, ~163)
- Modify: `src/services/write.service.ts` (lines ~119, ~178)
- Modify: `src/services/influxdb-master.service.ts` (getClient passthrough)
- Create: `tests/base-connection-user-auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/base-connection-user-auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BaseConnectionService } from "../src/services/base-connection.service.js";
import { McpServerConfig } from "../src/config.js";

function makeConfig(
  influx: Partial<McpServerConfig["influx"]>,
): McpServerConfig {
  return {
    influx: { type: "enterprise", ...influx },
    server: { name: "influxdb-mcp-server", version: "0.0.0" },
  };
}

const USER_AUTH_CONFIG = makeConfig({
  url: "http://localhost:8181",
  username: "alice",
  password: "pw",
});

describe("BaseConnectionService in user-auth mode", () => {
  it("reports data and management capabilities with credentials only", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    expect(svc.hasDataCapabilities()).toBe(true);
    expect(svc.hasManagementCapabilities()).toBe(true);
    expect(() => svc.validateDataCapabilities()).not.toThrow();
    expect(() => svc.validateManagementCapabilities()).not.toThrow();
  });

  it("still requires auth: enterprise with neither token nor credentials has no capabilities", () => {
    const svc = new BaseConnectionService(
      makeConfig({ url: "http://localhost:8181" }),
    );
    expect(svc.hasDataCapabilities()).toBe(false);
    expect(() => svc.validateDataCapabilities()).toThrow(
      /INFLUX_DB_TOKEN|credentials/i,
    );
  });

  it("token mode is unchanged", () => {
    const svc = new BaseConnectionService(
      makeConfig({ type: "core", url: "http://localhost:8181", token: "t" }),
    );
    expect(svc.hasDataCapabilities()).toBe(true);
    expect(svc.getConnectionInfo().authMode).toBe("token");
  });

  it("reports user auth mode and username in connection info", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    const info = svc.getConnectionInfo();
    expect(info.authMode).toBe("user");
    expect(info.username).toBe("alice");
    expect(info.hasToken).toBe(true); // "auth is configured"
  });

  it("builds the SDK client lazily after login and rebuilds on token rotation", async () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    let version = 1;
    // Replace the internal auth service with a stub: no network in unit tests.
    (svc as any).userAuth = {
      getToken: async () => `tok-${version}`,
      forceRefresh: async () => `tok-${++version}`,
      getTokenVersion: () => version,
      getAuthInfo: () => ({ username: "alice" }),
    };
    const first = await svc.getClient();
    expect(first).not.toBeNull();
    const again = await svc.getClient();
    expect(again).toBe(first); // same version, same client
    version = 2;
    const rebuilt = await svc.getClient();
    expect(rebuilt).not.toBe(first); // rotated token, rebuilt client
  });

  it("does not construct the SDK client at startup in user-auth mode", () => {
    const svc = new BaseConnectionService(USER_AUTH_CONFIG);
    expect(svc.getConnectionInfo().isDataClientInitialized).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/base-connection-user-auth.test.ts`
Expected: FAIL — capabilities false, `authMode` undefined, `getClient()` not a Promise.

- [ ] **Step 3: Implement BaseConnectionService changes**

In `src/services/base-connection.service.ts`:

Add import:

```typescript
import { UserAuthService } from "./user-auth.service.js";
```

Extend `ConnectionInfo`:

```typescript
export interface ConnectionInfo {
  isDataClientInitialized: boolean;
  url: string;
  hasToken: boolean;
  database?: string;
  type?: string;
  authMode: "token" | "user";
  username?: string;
}
```

Add fields and create the auth service in the constructor:

```typescript
export class BaseConnectionService {
  private client: InfluxDBClient | null = null;
  private config: McpServerConfig;
  private httpClient: HttpClientService;
  private userAuth: UserAuthService | null = null;
  private clientTokenVersion = -1;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.httpClient = new HttpClientService();
    const influx = config.influx;
    if (
      influx.type === InfluxProductType.Enterprise &&
      influx.url &&
      influx.username &&
      influx.password
    ) {
      this.userAuth = new UserAuthService(
        influx.url,
        influx.username,
        influx.password,
      );
    }
    this.initializeClient();
  }
```

In `initializeClient()`, skip construction in user-auth mode (there is no token until the first login; `getClient()` builds the client lazily). Replace the body with:

```typescript
  private initializeClient(): void {
    if (this.userAuth) {
      // User-auth mode: no token exists until the first login.
      // getClient() constructs the client lazily.
      return;
    }
    try {
      const influxConfig = this.config.influx;
      if (this.isValidConfig(influxConfig)) {
        const clientConfig: any = {
          host: this.getDataHost(),
          token: influxConfig.token,
        };
        this.client = new InfluxDBClient(clientConfig);
      }
    } catch (error) {
      console.error("Failed to initialize InfluxDB client:", error);
      this.client = null;
    }
  }
```

Update `isValidConfig` — the final return (Core/Enterprise and default) becomes:

```typescript
  private isValidConfig(config: InfluxConfig): boolean {
    if (config.type === InfluxProductType.CloudDedicated) {
      return !!(config.cluster_id && config.token);
    }
    if (config.type === InfluxProductType.CloudServerless) {
      return !!(config.url && config.token);
    }
    return !!(
      config.url &&
      (config.token || (config.username && config.password))
    );
  }
```

Update `hasManagementCapabilities` — the final return becomes:

```typescript
return !!(config.url && (config.token || (config.username && config.password)));
```

In `validateDataCapabilities` and `validateManagementCapabilities`, update the two Core/Enterprise token error messages (the `else` branches) to name both options:

```typescript
if (!config.token) {
  throw new Error(
    "Core/Enterprise data operations require INFLUX_DB_TOKEN, or INFLUX_DB_USERNAME and INFLUX_DB_PASSWORD (Enterprise user auth), in configuration",
  );
}
```

and

```typescript
if (!config.token) {
  throw new Error(
    "Core/Enterprise management operations require INFLUX_DB_TOKEN with management permissions, or INFLUX_DB_USERNAME and INFLUX_DB_PASSWORD (Enterprise user auth), in configuration",
  );
}
```

Note: these branches are only reached when `hasDataCapabilities()` / `hasManagementCapabilities()` is false, which in user-auth mode cannot happen (credentials make them true), so the message text is the only change needed.

Replace `getClient()` with the async version:

```typescript
  /**
   * Get the main client instance.
   * In user-auth mode the client is built lazily after login and rebuilt
   * whenever the access token rotates (the SDK has no token setter).
   */
  async getClient(): Promise<InfluxDBClient | null> {
    if (this.userAuth) {
      const token = await this.userAuth.getToken();
      const version = this.userAuth.getTokenVersion();
      if (!this.client || version !== this.clientTokenVersion) {
        this.client = new InfluxDBClient({
          host: this.getDataHost(),
          token,
        } as any);
        this.clientTokenVersion = version;
      }
    }
    return this.client;
  }
```

Update `getConnectionInfo()`:

```typescript
  getConnectionInfo(): ConnectionInfo {
    const influxConfig = this.config.influx;
    return {
      isDataClientInitialized: !!this.client,
      url: this.getDataHost() || "",
      hasToken: !!influxConfig.token || !!this.userAuth,
      type: influxConfig.type,
      authMode: this.userAuth ? "user" : "token",
      username: this.userAuth?.getAuthInfo().username,
    };
  }
```

Update `ping()` and `getHealthStatus()` to resolve the token through the auth service. In both, replace the `headers` construction. For `ping()`:

```typescript
    try {
      const token = this.userAuth
        ? await this.userAuth.getToken()
        : this.config.influx.token;
      const response = await fetch(`${url.replace(/\/$/, "")}/ping`, {
        headers: {
          Authorization: `Token ${token}`,
        },
      });
```

For `getHealthStatus()` (same pattern, and note its guard also references `this.client`, which is null before first use in user-auth mode — change the guard):

```typescript
    const url = this.getDataHost();
    if (!url || (!this.client && !this.userAuth)) {
      return { status: "fail" };
    }
    try {
      const token = this.userAuth
        ? await this.userAuth.getToken()
        : this.config.influx.token;
      const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
        headers: {
          Authorization: `Token ${token}`,
        },
      });
```

(The `Token` scheme is intentional v1/v2 compatibility. Whether the server accepts a JWT under `Token` is an open RC verification item — see Task 7.)

Update `getInfluxHttpClient()` to hand the provider to the HTTP client:

```typescript
  getInfluxHttpClient(forManagement = false): HttpClientService {
    const influxConfig = this.config.influx;
    const host =
      (forManagement ? this.getManagementHost() : this.getDataHost()) || "";

    let token: string = "";
    if (
      forManagement &&
      (influxConfig.type === InfluxProductType.CloudDedicated ||
        influxConfig.type === InfluxProductType.Clustered)
    ) {
      token = influxConfig.management_token || "";
    } else {
      token = influxConfig.token || "";
    }

    return HttpClientService.createInfluxClient(
      host,
      token,
      influxConfig.type,
      this.userAuth ?? undefined,
    );
  }
```

- [ ] **Step 4: Update getClient call sites to await**

In `src/services/query.service.ts` (two places, in `executeCloudDedicatedQuery` and `executeCloudServerlessQuery`):

```typescript
const client = await this.baseService.getClient();
```

In `src/services/write.service.ts` (two places, both write methods using the SDK client):

```typescript
const client = await this.baseService.getClient();
```

In `src/services/influxdb-master.service.ts`, the passthrough now returns a Promise:

```typescript
  /**
   * Get the main client instance (for advanced operations)
   */
  getClient() {
    return this.baseConnection.getClient();
  }
```

(No text change needed — it already forwards the return value — but verify nothing else calls it synchronously: `grep -rn "getClient()" src/ tests/` and confirm every call site awaits or returns the promise.)

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run tests/base-connection-user-auth.test.ts`
Expected: 6 passed.

Run: `npm run build && npm test`
Expected: clean compile; full suite passes (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/services/base-connection.service.ts src/services/query.service.ts src/services/write.service.ts src/services/influxdb-master.service.ts tests/base-connection-user-auth.test.ts
git commit -m "feat: wire user-auth provider through connection service and SDK client"
```

---

### Task 5: Status resource and protocol test for user-auth mode

**Files:**

- Modify: `src/resources/index.ts` (influx-config handler, ~line 34)
- Create: `tests/protocol-user-auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/protocol-user-auth.test.ts`. This spawns the compiled server with credentials instead of a token (`INFLUX_DB_TOKEN: ""` overrides the base test env; empty string is falsy in `loadConfig`):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

// Keep in sync with EXPECTED_TOOL_COUNT in tests/protocol.test.ts.
const EXPECTED_TOOL_COUNT = 22;

describe("MCP protocol in enterprise user-auth mode", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient({
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_DB_TOKEN: "",
      INFLUX_DB_USERNAME: "alice",
      INFLUX_DB_PASSWORD: "test-password-not-used",
    });
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("starts and advertises the same tool count as token mode", async () => {
    const result = await testClient.client.listTools();
    expect(result.tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("reports user auth mode in the config resource without secrets", async () => {
    const result = await testClient.client.readResource({
      uri: "influx://config",
    });
    const text = (result.contents[0] as { text: string }).text;
    const config = JSON.parse(text);
    expect(config.connection.authMode).toBe("user");
    expect(config.connection.username).toBe("alice");
    expect(text).not.toContain("test-password-not-used");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/protocol-user-auth.test.ts`
Expected: first test PASSES (config validation already accepts credentials); the resource test FAILS — `authMode` is undefined in the resource JSON.

- [ ] **Step 3: Add auth fields to the config resource**

In `src/resources/index.ts`, in the `influx-config` handler, extend the `connection` object:

```typescript
const config = {
  connection: {
    url: connectionInfo.url,
    hasToken: connectionInfo.hasToken,
    authMode: connectionInfo.authMode,
    username: connectionInfo.username,
    database: connectionInfo.database,
    isConnected,
  },
};
```

- [ ] **Step 4: Rebuild and run tests**

Run: `npm run build && npx vitest run tests/protocol-user-auth.test.ts tests/protocol.test.ts`
Expected: all pass. (The ping inside the resource handler fails fast against the dummy URL; the resource still renders with `isConnected: false`. The user-auth login is lazy, so no real InfluxDB is needed.)

- [ ] **Step 5: Commit**

```bash
git add src/resources/index.ts tests/protocol-user-auth.test.ts
git commit -m "feat: report auth mode in config resource; protocol test for user-auth"
```

---

### Task 6: Documentation — README and env example

**Files:**

- Modify: `README.md` (Core/Enterprise env section, ~lines 75–105)
- Modify: `env.example`

- [ ] **Step 1: Update env.example**

Read `env.example` first, then append (or place alongside the token entry):

```bash
# --- Enterprise user authentication (alternative to INFLUX_DB_TOKEN) ---
# Authenticate as an Enterprise user instead of using a static token.
# The server logs in, refreshes the access token automatically, and acts
# with this user's permissions. Set EITHER these two OR INFLUX_DB_TOKEN,
# not both. Requires user auth to be enabled on the InfluxDB server.
# INFLUX_DB_USERNAME=your_username
# INFLUX_DB_PASSWORD=your_password
```

- [ ] **Step 2: Update README**

In the Core/Enterprise environment-variable section (around lines 75–105), document the new variables. Read the section first and match its existing format. Content to convey:

```markdown
#### Enterprise user authentication (alternative to a static token)

For InfluxDB 3 Enterprise with user authentication enabled, the server can
authenticate as a user instead of using a static token:

- `INFLUX_DB_USERNAME` — Enterprise username
- `INFLUX_DB_PASSWORD` — Enterprise password

Set either `INFLUX_DB_TOKEN` or the username/password pair, not both. The
server exchanges the credentials for a short-lived access token, refreshes
it automatically, and runs every operation with that user's permissions.
Credentials and tokens are kept in memory only and never logged.
```

- [ ] **Step 3: Verify formatting and commit**

Run: `npx prettier --check README.md env.example` (fix with `npx prettier --write` if needed)

```bash
git add README.md env.example
git commit -m "docs: document INFLUX_DB_USERNAME/PASSWORD for enterprise user auth"
```

---

### Task 7: Gated integration test for the release candidate

**Files:**

- Create: `tests/user-auth-integration.test.ts`

This test only runs when pointed at a live Enterprise instance with user auth enabled (the v3.10 release candidate). It follows the existing `INFLUX_TEST_ENABLED` gating pattern from `tests/integration.test.ts`.

- [ ] **Step 1: Write the gated integration test**

Create `tests/user-auth-integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestClient, TestClient } from "./helpers/mcp-client.js";

const RUN =
  (process.env.INFLUX_TEST_ENABLED === "true" ||
    process.env.INFLUX_TEST_ENABLED === "1") &&
  !!process.env.INFLUX_DB_USERNAME &&
  !!process.env.INFLUX_DB_PASSWORD;

const DB = process.env.INFLUX_DB_TEST_DATABASE || "user_auth_test";

function toolText(result: any): string {
  return (
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ""
  );
}

describe.skipIf(!RUN)("live Enterprise user-auth integration", () => {
  let testClient: TestClient;

  beforeAll(async () => {
    testClient = await createTestClient({
      INFLUX_DB_INSTANCE_URL: process.env.INFLUX_DB_INSTANCE_URL!,
      INFLUX_DB_PRODUCT_TYPE: "enterprise",
      INFLUX_DB_TOKEN: "",
      INFLUX_DB_USERNAME: process.env.INFLUX_DB_USERNAME!,
      INFLUX_DB_PASSWORD: process.env.INFLUX_DB_PASSWORD!,
    });
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("health_check succeeds with user credentials", async () => {
    const result = await testClient.client.callTool({
      name: "health_check",
      arguments: {},
    });
    expect(toolText(result)).toMatch(/healthy|pass|ok/i);
  });

  it("lists databases as the authenticated user", async () => {
    const result = await testClient.client.callTool({
      name: "list_databases",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
  });

  it("writes and queries back a point (SDK write path + HTTP query path)", async () => {
    await testClient.client.callTool({
      name: "create_database",
      arguments: { name: DB },
    });
    const write = await testClient.client.callTool({
      name: "write_line_protocol",
      arguments: {
        database: DB,
        data: `user_auth_smoke,source=mcp value=1i`,
        precision: "second",
      },
    });
    expect(write.isError).toBeFalsy();
    const query = await testClient.client.callTool({
      name: "execute_query",
      arguments: {
        database: DB,
        query: "SELECT * FROM user_auth_smoke ORDER BY time DESC LIMIT 1",
      },
    });
    expect(toolText(query)).toContain("user_auth_smoke");
  });

  it("config resource reports user auth mode", async () => {
    const result = await testClient.client.readResource({
      uri: "influx://config",
    });
    const config = JSON.parse((result.contents[0] as { text: string }).text);
    expect(config.connection.authMode).toBe("user");
  });
});
```

Argument names are verified against the tool schemas in `src/tools/categories/write.tools.ts`, `query.tools.ts`, and `database.tools.ts` (`database`/`data`/`precision`, `database`/`query`, `name`).

- [ ] **Step 2: Verify it is skipped without env**

Run: `npm run build && npx vitest run tests/user-auth-integration.test.ts`
Expected: all tests reported as skipped.

- [ ] **Step 3: Commit**

```bash
git add tests/user-auth-integration.test.ts
git commit -m "test: add gated integration test for enterprise user auth"
```

- [ ] **Step 4: Run against the release candidate (manual, when the RC is available)**

Bootstrap the RC instance (verify exact flags against the RC docs/help):

```bash
# Start the RC with user auth; then create the initial admin user.
influxdb3 manage init-admin --username admin --password '<choose>'
# Or create a non-admin test user with appropriate permissions.
```

Then:

```bash
INFLUX_TEST_ENABLED=true \
INFLUX_DB_INSTANCE_URL=http://localhost:8181 \
INFLUX_DB_USERNAME=admin \
INFLUX_DB_PASSWORD='<password>' \
npx vitest run tests/user-auth-integration.test.ts
```

Expected: 4 passed.

**RC verification checklist** (from the spec — record findings in the spec doc):

1. `/ping` and `/health` accept the JWT under the `Token` scheme? If not, switch those two calls to `Bearer` in user-auth mode (in `BaseConnectionService.ping`/`getHealthStatus`).
2. HTTP status of `UsersNotEnabled` (run the server without user auth enabled and attempt login; adjust the 404 hint in `UserAuthService.authError` if the status differs).
3. Exact `manage init-admin` / server-flag bootstrap sequence — update this task's Step 4 commands with what actually works.
4. Long-session refresh: leave a session open >1h or lower the TTL if the RC allows, and confirm queries keep working (proves proactive refresh end to end).

---

### Task 8: Final verification

- [ ] **Step 1: Full local gate**

```bash
npm run build && npm run lint && npx prettier --check . && npm test
```

Expected: zero warnings, zero failures (new totals: previous 25 passed + ~29 new unit/protocol tests; 6 + 4 skipped integration).

- [ ] **Step 2: Re-read the diff against the spec**

```bash
git diff main...HEAD --stat
```

Check each spec section has landed: config matrix, UserAuthService behavior, HTTP provider + 401 retry, capability checks, async getClient + call sites, ping/health, resource fields, docs, tests. Confirm no token/password value can appear in any error message or log (search the diff for `console.` additions and error construction).

- [ ] **Step 3: Commit any remaining fixes; do not push or open a PR without explicit request**
