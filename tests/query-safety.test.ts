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
