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
    if (this.shouldAddLimit(firstKeyword, normalizedQuery)) {
      normalizedQuery = `${normalizedQuery} LIMIT ${maxRows}`;
      warnings.push({
        code: "limit_added",
        message: `Added LIMIT ${maxRows} to enforce a bounded result set.`,
      });
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

  private shouldAddLimit(firstKeyword: string, query: string): boolean {
    if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
      return false;
    }
    return !/\blimit\s+\d+\b/iu.test(query);
  }
}
