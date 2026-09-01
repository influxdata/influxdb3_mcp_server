/**
 * Shared error normalization for the write and query paths.
 *
 * Two transports throw two different error shapes: axios (`error.response.*`)
 * for the Core/Enterprise/Clustered HTTP paths, and the InfluxDB SDK's
 * `HttpError` (`error.statusCode`, `error.json`/`error.body`) for the
 * Cloud Dedicated/Serverless paths. `normalizeError` collapses both to one
 * shape so status-branching code doesn't need to know which transport threw.
 */

export interface NormalizedError {
  status: number | undefined;
  body: unknown;
}

export function normalizeError(error: any): NormalizedError {
  if (error?.response) {
    return { status: error.response.status, body: error.response.data };
  }
  if (typeof error?.statusCode === "number") {
    return { status: error.statusCode, body: error.json ?? error.body };
  }
  return { status: undefined, body: undefined };
}

/**
 * Resolve the actionable message out of an InfluxDB error body.
 *
 * Write-path partial-write bodies nest the actionable detail under
 * `data.data[].error_message` (when `accept_partial=true`, an array) or
 * `data.data.error_message` (when `accept_partial=false`, an object) — one
 * level below `data.error`, which is only ever the generic "partial write of
 * line protocol occurred". Those two arms are checked first; query-path
 * bodies never have a `data.data`, so they fall through unaffected.
 */
export function resolveErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const data = body as Record<string, unknown>;

    const partialData =
      data.data && typeof data.data === "object"
        ? (Array.isArray(data.data) ? data.data[0] : data.data) as
            | Record<string, unknown>
            | undefined
        : undefined;
    if (typeof partialData?.error_message === "string") {
      return partialData.error_message;
    }

    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
    return Object.keys(data).length === 0 ? fallback : JSON.stringify(data);
  }

  if (typeof body === "string") return body;
  return fallback;
}
