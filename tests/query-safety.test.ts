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
