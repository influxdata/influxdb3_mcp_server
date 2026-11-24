import type { HttpClientService } from "./http-client.service.js";
import { OperationError } from "./error-resolution.service.js";

/** Errors in a v1 `/query` body. The v1 API reports a failed statement with HTTP 200. */
function v1StatementErrors(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const { error, results } = body as { error?: unknown; results?: unknown };
  const errors = typeof error === "string" ? [error] : [];
  if (!Array.isArray(results)) return errors;
  for (const result of results) {
    if (typeof result?.error === "string") errors.push(result.error);
  }
  return errors;
}

interface V1Series {
  name?: string;
  tags?: Record<string, unknown>;
  columns?: string[];
  values?: unknown[][];
}

/**
 * Rows from a v1 `/query` body, one per value in every series, in the shape
 * Core and Enterprise return from `/api/v3/query_influxql`: the measurement
 * as `iox::measurement`, then the series tags, then the columns. A statement
 * with no `series` contributes no rows.
 */
export function v1SeriesRows(body: unknown): Record<string, unknown>[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const result of results) {
    const series: V1Series[] = Array.isArray(result?.series)
      ? result.series
      : [];
    for (const { name, tags, columns = [], values = [] } of series) {
      for (const value of values) {
        rows.push({
          ...(name !== undefined && { "iox::measurement": name }),
          ...tags,
          ...Object.fromEntries(
            columns.map((column, index) => [column, value[index]]),
          ),
        });
      }
    }
  }
  return rows;
}

/**
 * GET a v1 `/query` and return its body. A statement error, which the v1 API
 * returns with HTTP 200, is thrown as an `OperationError` with code
 * `query_failed`.
 */
export async function queryV1(
  httpClient: HttpClientService,
  config: Record<string, unknown>,
): Promise<any> {
  const body = await httpClient.get("/query", config);
  const statementErrors = v1StatementErrors(body);
  if (statementErrors.length > 0) {
    throw new OperationError(statementErrors.join("; "), "query_failed");
  }
  return body;
}
