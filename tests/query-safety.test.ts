import { describe, expect, it } from "vitest";
import { QuerySafetyService } from "../src/services/query-safety.service.js";

describe("QuerySafetyService", () => {
  const service = new QuerySafetyService();

  it("allows bounded read-only SQL", () => {
    const result = service.validate(
      "SELECT usage FROM cpu WHERE time >= now() - interval '1 hour' LIMIT 10",
      "sql",
    );

    expect(result.ok).toBe(true);
    expect(result.normalizedQuery).toContain("LIMIT 10");
  });

  it("adds a limit to unbounded SQL SELECT", () => {
    const result = service.validate("SELECT usage FROM cpu", "sql", 25);

    expect(result.ok).toBe(true);
    expect(result.normalizedQuery).toBe("SELECT usage FROM cpu LIMIT 25");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "limit_added" }),
      ]),
    );
  });

  it("reduces excessive SQL LIMIT values", () => {
    const result = service.validate(
      "SELECT usage FROM cpu LIMIT 10000",
      "sql",
      50,
    );

    expect(result.ok).toBe(true);
    expect(result.normalizedQuery).toBe("SELECT usage FROM cpu LIMIT 50");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "limit_reduced" }),
      ]),
    );
  });

  it.each(["sql", "influxql"] as const)(
    "adds an outer limit when a nested %s query is the only bounded query",
    (language) => {
      const query =
        language === "sql"
          ? "SELECT * FROM metrics WHERE host IN (SELECT host FROM hosts LIMIT 1)"
          : "SELECT * FROM (SELECT * FROM metrics LIMIT 1)";

      const result = service.validate(query, language, 25);

      expect(result.normalizedQuery).toBe(`${query} LIMIT 25`);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "limit_added" }),
      );
    },
  );

  it("only reduces the outer SQL limit", () => {
    const result = service.validate(
      "SELECT * FROM (SELECT * FROM metrics LIMIT 1000) LIMIT 100",
      "sql",
      25,
    );

    expect(result.normalizedQuery).toBe(
      "SELECT * FROM (SELECT * FROM metrics LIMIT 1000) LIMIT 25",
    );
  });

  it("does not treat limits in strings, comments, or identifiers as outer limits", () => {
    const query =
      "SELECT \"limit\" FROM metrics WHERE note = 'LIMIT 100' /* LIMIT 100 */";

    const result = service.validate(query, "sql", 25);

    expect(result.normalizedQuery).toBe(`${query} LIMIT 25`);
  });

  it("appends a limit outside a trailing line comment", () => {
    const query = "SELECT * FROM metrics -- LIMIT 100";

    const result = service.validate(query, "sql", 25);

    expect(result.normalizedQuery).toBe(`${query}\nLIMIT 25`);
  });

  it("rejects SQL writes and multi-statement input", () => {
    expect(service.validate("DROP TABLE cpu", "sql").code).toBe(
      "not_read_only",
    );
    expect(
      service.validate("SELECT * FROM cpu; DROP TABLE cpu", "sql").code,
    ).toBe("multiple_statements");
  });

  it.each([
    ["sql", "SELECT 'DROP TABLE metrics' AS note FROM cpu"],
    ["sql", 'SELECT "delete" FROM cpu WHERE time > now() - 1h'],
    ["influxql", "SELECT usage FROM cpu WHERE note = 'drop it'"],
    ["influxql", 'SELECT "into" FROM cpu'],
  ] as const)(
    "allows a %s write keyword inside a string literal or quoted identifier: %s",
    (language, query) => {
      expect(service.validate(query, language)).toMatchObject({ ok: true });
    },
  );

  it("allows a semicolon inside a string literal", () => {
    expect(
      service.validate("SELECT 'a;b' AS note FROM cpu", "sql"),
    ).toMatchObject({ ok: true });
  });

  it("does not let a comment marker inside a literal hide a write keyword", () => {
    expect(
      service.validate("SELECT '--' AS note FROM cpu DROP TABLE cpu", "sql")
        .code,
    ).toBe("not_read_only");
  });

  // The rejected-keyword lists as of 875d600. Stripping literals must not
  // let any of them through when it appears outside a literal.
  it.each([
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
    "COPY",
    "EXPORT",
    "ATTACH",
    "GRANT",
    "REVOKE",
    "TRUNCATE",
  ])("still rejects SQL %s outside a literal", (keyword) => {
    expect(service.validate(`${keyword} TABLE cpu`, "sql").code).toBe(
      "not_read_only",
    );
    expect(
      service.validate(`SELECT 'x' AS note FROM cpu ${keyword} t`, "sql").code,
    ).toBe("not_read_only");
  });

  it.each([
    ["DELETE", "not_read_only"],
    ["DROP", "not_read_only"],
    ["CREATE", "not_read_only"],
    ["ALTER", "not_read_only"],
    ["GRANT", "not_read_only"],
    ["REVOKE", "not_read_only"],
    ["INTO", "select_into"],
  ])("still rejects InfluxQL %s outside a literal", (keyword, code) => {
    expect(
      service.validate(`SELECT 'x' FROM cpu ${keyword} t`, "influxql").code,
    ).toBe(code);
  });

  it("allows read-only InfluxQL", () => {
    const result = service.validate("SHOW MEASUREMENTS", "influxql");

    expect(result.ok).toBe(true);
    expect(result.normalizedQuery).toBe("SHOW MEASUREMENTS");
  });

  it("rejects InfluxQL SELECT INTO", () => {
    const result = service.validate(
      "SELECT mean(value) INTO rollup FROM cpu",
      "influxql",
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe("select_into");
  });
});
