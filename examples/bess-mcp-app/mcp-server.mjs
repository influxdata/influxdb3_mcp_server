// Only the reader credential enters the MCP process.
import fs from "node:fs/promises";
import { connection, readerFile } from "./config.mjs";

const { token } = JSON.parse(await fs.readFile(readerFile, "utf8"));
if (!token)
  throw Error("The reader credential file must contain a token field.");
process.env.INFLUX_DB_INSTANCE_URL = connection.host;
process.env.INFLUX_DB_TOKEN = token;
process.env.INFLUX_DB_PRODUCT_TYPE = connection.product;
process.env.INFLUX_MCP_TOOL_PROFILE = "readonly";
await import(new URL("../../build/index.js", import.meta.url));
