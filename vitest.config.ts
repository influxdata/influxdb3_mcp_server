import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Live files create scratch databases on a shared testbench. Core's
    // five-database limit leaves room for only one scratch database at a time.
    fileParallelism:
      process.env.INFLUX_TEST_ENABLED !== "true" &&
      process.env.INFLUX_TEST_ENABLED !== "1",
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
