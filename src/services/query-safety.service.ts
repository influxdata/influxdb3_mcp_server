export type QueryLanguage = "sql" | "influxql";

export interface QueryWarning {
  code: string;
  message: string;
}

export interface QuerySafetyResult {
  ok: boolean;
  code?: string;
  message?: string;
  fix?: string;
  normalizedQuery?: string;
  warnings: QueryWarning[];
}

const SQL_ALLOWED = new Set(["SELECT", "SHOW", "EXPLAIN", "WITH"]);
const INFLUXQL_ALLOWED = new Set(["SELECT", "SHOW"]);

const SQL_REJECTED = [
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
];

const INFLUXQL_REJECTED = [
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "GRANT",
  "REVOKE",
  "INTO",
];

export class QuerySafetyService {
  validate(
    query: string,
    language: QueryLanguage,
    maxRows = 1000,
  ): QuerySafetyResult {
    const trimmed = query.trim();
    const warnings: QueryWarning[] = [];

    if (!trimmed) {
      return this.reject("empty_query", "Query cannot be empty.");
    }

    if (this.hasMultipleStatements(trimmed)) {
      return this.reject(
        "multiple_statements",
        "Read-only query tools only accept one statement.",
        "Submit one SELECT, SHOW, EXPLAIN, or WITH statement.",
      );
    }

    const commentless = this.stripComments(trimmed);
    const firstKeyword = this.firstKeyword(commentless);
    const allowed = language === "sql" ? SQL_ALLOWED : INFLUXQL_ALLOWED;

    if (!firstKeyword || !allowed.has(firstKeyword)) {
      return this.reject(
        "not_read_only",
        `${language === "sql" ? "SQL" : "InfluxQL"} query must start with ${Array.from(allowed).join(", ")}.`,
        language === "sql"
          ? "Use SELECT, SHOW, EXPLAIN, or WITH."
          : "Use SELECT or SHOW.",
      );
    }

    const rejected = language === "sql" ? SQL_REJECTED : INFLUXQL_REJECTED;
    const upper = commentless.toUpperCase();
    const rejectedKeyword = rejected.find((keyword) =>
      new RegExp(`\\b${keyword}\\b`, "u").test(upper),
    );

    if (rejectedKeyword) {
      const code =
        language === "influxql" && rejectedKeyword === "INTO"
          ? "select_into"
          : "not_read_only";
      return this.reject(
        code,
        `Read-only ${language === "sql" ? "SQL" : "InfluxQL"} cannot use ${rejectedKeyword}.`,
        language === "sql"
          ? "Use SELECT, SHOW, EXPLAIN, or WITH."
          : "Use SELECT or SHOW without INTO.",
      );
    }

    let normalizedQuery = trimmed.replace(/;+$/u, "");
    const limit = this.topLevelLimit(normalizedQuery);
    if (this.shouldEnforceLimit(firstKeyword)) {
      if (limit === undefined) {
        normalizedQuery = this.appendLimit(normalizedQuery, maxRows);
        warnings.push({
          code: "limit_added",
          message: `Added LIMIT ${maxRows} to enforce a bounded result set.`,
        });
      } else if (limit.value > maxRows) {
        normalizedQuery = `${normalizedQuery.slice(0, limit.valueStart)}${maxRows}${normalizedQuery.slice(limit.valueEnd)}`;
        warnings.push({
          code: "limit_reduced",
          message: `Reduced LIMIT ${limit.value} to ${maxRows}.`,
        });
      }
    }

    if (
      firstKeyword !== "SHOW" &&
      firstKeyword !== "EXPLAIN" &&
      !/\btime\b/u.test(commentless.toLowerCase())
    ) {
      warnings.push({
        code: "missing_time_predicate",
        message: "Query has no obvious time predicate.",
      });
    }

    return {
      ok: true,
      normalizedQuery,
      warnings,
    };
  }

  private reject(
    code: string,
    message: string,
    fix?: string,
  ): QuerySafetyResult {
    return {
      ok: false,
      code,
      message,
      fix,
      warnings: [],
    };
  }

  private firstKeyword(query: string): string | undefined {
    return query
      .trim()
      .match(/^([a-z_]+)/iu)?.[1]
      ?.toUpperCase();
  }

  private hasMultipleStatements(query: string): boolean {
    const withoutTrailing = query.trim().replace(/;+$/u, "");
    return withoutTrailing.includes(";");
  }

  private stripComments(query: string): string {
    return query
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/--.*$/gmu, " ")
      .trim();
  }

  private shouldEnforceLimit(firstKeyword: string): boolean {
    return firstKeyword === "SELECT" || firstKeyword === "WITH";
  }

  private topLevelLimit(
    query: string,
  ): { value: number; valueStart: number; valueEnd: number } | undefined {
    let depth = 0;

    for (let index = 0; index < query.length; ) {
      const character = query[index];
      const next = query[index + 1];

      if (character === "'" || character === '"' || character === "`") {
        index = this.skipQuoted(query, index, character);
      } else if (character === "-" && next === "-") {
        index = query.indexOf("\n", index + 2);
        if (index === -1) return undefined;
      } else if (character === "/" && next === "*") {
        const end = query.indexOf("*/", index + 2);
        index = end === -1 ? query.length : end + 2;
      } else if (character === "(") {
        depth += 1;
        index += 1;
      } else if (character === ")") {
        depth = Math.max(0, depth - 1);
        index += 1;
      } else if (
        depth === 0 &&
        query.slice(index, index + 5).toUpperCase() === "LIMIT" &&
        !this.isIdentifierCharacter(query[index - 1]) &&
        !this.isIdentifierCharacter(query[index + 5])
      ) {
        let valueStart = index + 5;
        while (/\s/u.test(query[valueStart] ?? "")) valueStart += 1;
        const valueEnd = this.readDigits(query, valueStart);
        if (valueEnd > valueStart) {
          return {
            value: Number(query.slice(valueStart, valueEnd)),
            valueStart,
            valueEnd,
          };
        }
        index += 5;
      } else {
        index += 1;
      }
    }

    return undefined;
  }

  private skipQuoted(query: string, start: number, quote: string): number {
    for (let index = start + 1; index < query.length; index += 1) {
      if (query[index] !== quote) continue;
      if (query[index + 1] === quote) {
        index += 1;
        continue;
      }
      return index + 1;
    }
    return query.length;
  }

  private appendLimit(query: string, maxRows: number): string {
    const separator = this.endsInLineComment(query) ? "\n" : " ";
    return `${query}${separator}LIMIT ${maxRows}`;
  }

  private endsInLineComment(query: string): boolean {
    for (let index = 0; index < query.length; ) {
      const character = query[index];
      const next = query[index + 1];

      if (character === "'" || character === '"' || character === "`") {
        index = this.skipQuoted(query, index, character);
      } else if (character === "-" && next === "-") {
        const end = query.indexOf("\n", index + 2);
        if (end === -1) return true;
        index = end + 1;
      } else if (character === "/" && next === "*") {
        const end = query.indexOf("*/", index + 2);
        index = end === -1 ? query.length : end + 2;
      } else {
        index += 1;
      }
    }

    return false;
  }

  private isIdentifierCharacter(character: string | undefined): boolean {
    return !!character && /[A-Za-z0-9_$]/u.test(character);
  }

  private readDigits(query: string, start: number): number {
    let end = start;
    while (/\d/u.test(query[end] ?? "")) end += 1;
    return end;
  }
}
