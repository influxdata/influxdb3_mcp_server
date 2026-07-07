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
    } else if (status === 503) {
      detail =
        "503 Service Unavailable (user authentication is not enabled, or JWT signing is not configured — set --without-user-auth false and --jwt-private-key)";
    } else if (status === 404) {
      detail = "404 Not Found (the server may not support user authentication)";
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
