import { defineConfig } from "vitest/config";

const liveTestsEnabled =
  process.env.INFLUX_TEST_ENABLED === "true" ||
  process.env.INFLUX_TEST_ENABLED === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: !liveTestsEnabled,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
