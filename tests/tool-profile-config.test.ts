import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, validateConfig } from "../src/config.js";

const BASE_ENV = {
  INFLUX_DB_INSTANCE_URL: "http://localhost:8181",
  INFLUX_DB_TOKEN: "test-token-not-used",
  INFLUX_DB_PRODUCT_TYPE: "core",
};

function configWithProfile(profile: string | undefined) {
  for (const [key, value] of Object.entries(BASE_ENV)) {
    vi.stubEnv(key, value);
  }
  vi.stubEnv("INFLUX_MCP_TOOL_PROFILE", profile);
  return loadConfig();
}

describe("INFLUX_MCP_TOOL_PROFILE validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to operator when unset", () => {
    const config = configWithProfile(undefined);
    expect(config.tools.profile).toBe("operator");
    expect(() => validateConfig(config)).not.toThrow();
  });

  it.each(["readonly", "readwrite", "operator"])("accepts %s", (profile) => {
    const config = configWithProfile(profile);
    expect(() => validateConfig(config)).not.toThrow();
  });

  it.each(["default", "read-only", "READONLY", "readonly "])(
    "rejects %j instead of falling back to operator",
    (profile) => {
      const config = configWithProfile(profile);
      expect(() => validateConfig(config)).toThrow(
        /INFLUX_MCP_TOOL_PROFILE must be one of: readonly, readwrite, operator/,
      );
    },
  );
});
