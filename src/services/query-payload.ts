/**
 * Split a query result into records, whatever its format, so that the
 * read-only tools can apply a row bound and count rows the same way for
 * JSON rows and for CSV or JSONL text.
 */

export type QueryFormat = "json" | "csv" | "parquet" | "jsonl" | "pretty";

/** Use a recognized response media type; older endpoints may omit it. */
export function returnedQueryFormat(
  contentType: string | undefined,
  requested: QueryFormat,
): QueryFormat {
  switch (contentType?.split(";", 1)[0].trim().toLowerCase()) {
    case "application/json":
      return "json";
    case "application/jsonl":
    case "application/ndjson":
    case "application/x-ndjson":
      return "jsonl";
    case "text/csv":
      return "csv";
    default:
      return requested;
  }
}

export interface DecodedPayload {
  /** The format of the payload the server returned, which may differ from the one requested. */
  format: QueryFormat;
  /** JSON rows, or CSV or JSONL record lines. */
  records: unknown[];
  /** Build the response's `rows` from a subset of `records`. */
  render: (records: unknown[]) => any[];
}

export function decodePayload(
  raw: unknown,
  requested: QueryFormat,
): DecodedPayload {
  if (typeof raw !== "string") return jsonPayload(jsonRows(raw));
  if (requested === "json") return jsonPayload(jsonRows(raw));

  const returnedJson = parseJsonArray(raw);
  if (returnedJson) return jsonPayload(returnedJson);

  if (requested === "csv") {
    const [header = "", ...records] = splitCsvLines(raw);
    return {
      format: "csv",
      records,
      render: (kept) => [{ value: header + kept.join("") }],
    };
  }

  if (requested === "jsonl") {
    const records = splitLines(raw).filter((line) => line.trim() !== "");
    return {
      format: "jsonl",
      records,
      render: (kept) => [{ value: kept.join("") }],
    };
  }

  return {
    format: requested,
    records: [raw],
    render: (kept) => kept.map((value) => ({ value })),
  };
}

function jsonPayload(rows: unknown[]): DecodedPayload {
  return { format: "json", records: rows, render: (kept) => kept };
}

function jsonRows(raw: any): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.data)) return raw.data;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

function parseJsonArray(text: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Lines of a CSV payload, each with its newline; quoted newlines stay inside their record. */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "\n" && !inQuotes) {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}
