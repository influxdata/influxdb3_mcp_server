import { describe, it, expect } from "vitest";
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
