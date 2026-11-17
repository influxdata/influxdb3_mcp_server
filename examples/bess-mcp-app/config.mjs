import fs from "node:fs/promises";
import path from "node:path";

export const root = import.meta.dirname;
const input = JSON.parse(
  await fs.readFile(path.join(root, "connection.json"), "utf8"),
);
const url = new URL(input.host);
if (
  !["http:", "https:"].includes(url.protocol) ||
  url.username ||
  url.password
) {
  throw Error("Use an HTTP(S) database host without embedded credentials.");
}
if (
  typeof input.database !== "string" ||
  !input.database.trim() ||
  !["core", "enterprise"].includes(input.product)
) {
  throw Error(
    "Set database and product (core or enterprise) in connection.json.",
  );
}
export const connection = {
  host: url.href.replace(/\/$/, ""),
  database: input.database,
  product: input.product,
};
export const readerFile = process.env.INFLUXDB_READ_TOKEN_FILE
  ? path.resolve(process.env.INFLUXDB_READ_TOKEN_FILE)
  : path.join(root, ".secrets/read.json");
export const port = Number(process.env.PORT || 8091);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error("PORT must be an integer between 1024 and 65535.");
}
export const launcher = path.join(root, "mcp-server.mjs");
