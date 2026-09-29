import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import dotenv from "dotenv";

const envFile =
  process.env.INFLUX_TEST_ENV_FILE ?? ".env.cloud-serverless.local";

dotenv.config({ path: envFile, override: false, quiet: true });

const claireAliases = {
  INFLUX_DB_INSTANCE_URL: "INFLUXDB3_CLOUD_URL",
  INFLUX_DB_TOKEN: "INFLUXDB3_CLOUD_TOKEN",
  INFLUX_TEST_DATABASE: "INFLUXDB3_CLOUD_BUCKET",
  INFLUX_TEST_ORG: "INFLUXDB3_CLOUD_ORG",
};

for (const [runtimeName, claireName] of Object.entries(claireAliases)) {
  process.env[runtimeName] ||= process.env[claireName];
}

const requiredVariables = [
  "INFLUX_DB_INSTANCE_URL",
  "INFLUX_DB_TOKEN",
  "INFLUX_TEST_DATABASE",
];
const placeholderPattern = /your[_-]|your-region|example\.com/iu;
const invalidVariables = requiredVariables.filter((name) => {
  const value = process.env[name]?.trim();
  return !value || placeholderPattern.test(value);
});

if (invalidVariables.length > 0) {
  console.error(
    `Cloud Serverless tests require ${invalidVariables.join(
      ", ",
    )}. Set the INFLUXDB3_CLOUD_* aliases or MCP runtime variables in ${envFile} or in the process environment.`,
  );
  process.exit(2);
}

const requestedTests = process.argv.slice(2);
const testArguments = [
  fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
  "run",
  ...(requestedTests.length > 0 ? requestedTests : ["integration"]),
];

const child = spawn(process.execPath, testArguments, {
  env: {
    ...process.env,
    INFLUX_TEST_ENABLED: "true",
    INFLUX_DB_PRODUCT_TYPE: "cloud-serverless",
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Couldn't start Cloud Serverless tests: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Cloud Serverless tests stopped after signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
