import { describe, expect, it } from "vitest";
import { createQueryTools } from "../src/tools/categories/query.tools.js";

const tools = createQueryTools({} as any);

describe.each(["query_sql", "query_influxql"])("%s input", (name) => {
  const tool = tools.find((t) => t.name === name)!;

  it("accepts q", () => {
    expect(tool.zodSchema.parse({ db: "d", q: "SELECT 1" })).toMatchObject({
      q: "SELECT 1",
    });
  });

  it("accepts query as an alias for q", () => {
    const parsed = tool.zodSchema.parse({ db: "d", query: "SELECT 1" });
    expect(parsed).toMatchObject({ q: "SELECT 1" });
    expect(parsed).not.toHaveProperty("query");
  });

  it("rejects conflicting q and query", () => {
    expect(() =>
      tool.zodSchema.parse({ db: "d", q: "SELECT 1", query: "SELECT 2" }),
    ).toThrow();
  });

  it("rejects when neither is given", () => {
    expect(() => tool.zodSchema.parse({ db: "d" })).toThrow();
  });

  it("advertises both properties without a top-level anyOf", () => {
    expect(tool.inputSchema.properties).toHaveProperty("q");
    expect(tool.inputSchema.properties).toHaveProperty("query");
    expect(tool.inputSchema.required).toEqual(["db"]);
    expect(tool.inputSchema).not.toHaveProperty("anyOf");
  });
});
