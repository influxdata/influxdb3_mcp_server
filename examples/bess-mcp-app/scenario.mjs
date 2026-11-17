import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { root } from "./config.mjs";

export async function setScenario(action) {
  if (!["heat", "reset"].includes(action)) throw Error("Choose heat or reset.");
  const scenario = {
    mode: action === "heat" ? "heat" : "normal",
    started_at: Date.now() / 1000,
    duration_s: action === "heat" ? 600 : 0,
  };
  const directory = path.join(root, ".runtime");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `scenario-${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(scenario), { mode: 0o600 });
  await fs.rename(temporary, path.join(directory, "scenario.json"));
  return scenario;
}
