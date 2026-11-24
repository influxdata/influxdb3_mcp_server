import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
import type {
  Scenario,
  ScriptedFixedResponse,
  ScriptedTable,
  TableInterruption,
} from "../fixtures/influxdb-scenarios.js";

export interface RecordedRequest {
  method: string;
  path: string;
  db?: string;
  q?: string;
  format?: string;
  body?: unknown;
}

export interface FakeInfluxDB {
  url: string;
  requests: RecordedRequest[];
  unmatched: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startFakeInfluxDB(
  scenarios: Scenario[],
): Promise<FakeInfluxDB> {
  const requests: RecordedRequest[] = [];
  const unmatched: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const recorded = await recordRequest(req);
    requests.push(recorded);

    const scenario = firstMatchingScenario(scenarios, recorded);
    if (!scenario) {
      unmatched.push(recorded);
      sendBody(res, {
        status: 500,
        body: `fake influxdb: no scenario for ${recorded.method} ${recorded.path}`,
      });
      return;
    }

    if ("table" in scenario.response) {
      sendTable(res, scenario.response, recorded);
    } else {
      const response = scenario.response;
      setTimeout(() => sendBody(res, response), response.delayMs ?? 0);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    unmatched,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function recordRequest(req: IncomingMessage): Promise<RecordedRequest> {
  const url = new URL(req.url ?? "/", "http://fake");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");

  let body: any;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  return {
    method: req.method ?? "GET",
    path: url.pathname,
    db: body?.db ?? url.searchParams.get("db") ?? undefined,
    q: body?.q ?? url.searchParams.get("q") ?? undefined,
    format: body?.format ?? url.searchParams.get("format") ?? undefined,
    body,
  };
}

function firstMatchingScenario(
  scenarios: Scenario[],
  request: RecordedRequest,
): Scenario | undefined {
  return scenarios.find((candidate) => matches(candidate, request));
}

function matches(scenario: Scenario, request: RecordedRequest): boolean {
  const expected = scenario.request;
  if (expected.method !== request.method) return false;
  if (expected.path !== request.path) return false;
  if (expected.db !== undefined && expected.db !== request.db) return false;
  if (expected.q !== undefined && !expected.q.test(request.q ?? "")) {
    return false;
  }
  return true;
}

function sendBody(res: ServerResponse, response: ScriptedFixedResponse): void {
  const isText = typeof response.body === "string";
  res.writeHead(response.status, {
    "content-type": isText ? "text/plain" : "application/json",
    ...response.headers,
  });
  res.end(isText ? response.body : JSON.stringify(response.body));
}

function sendTable(
  res: ServerResponse,
  response: ScriptedTable,
  request: RecordedRequest,
): void {
  const limit = trailingLimit(request.q);
  const rows =
    limit === undefined ? response.table : response.table.slice(0, limit);
  const format = request.format ?? "json";

  const contentType = CONTENT_TYPES[format];
  if (!contentType) {
    sendBody(res, {
      status: 500,
      body: `fake influxdb: table scenarios do not encode format '${format}'`,
    });
    return;
  }

  res.writeHead(200, { "content-type": contentType });
  if (response.interrupt) {
    sendJsonRowsThenPartialRowThenStop(res, rows, response.interrupt);
    return;
  }

  switch (format) {
    case "json":
      res.end(JSON.stringify(rows));
      return;
    case "jsonl":
      res.end(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
      return;
    case "csv":
      res.end(toCsv(rows));
  }
}

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json",
  jsonl: "application/jsonl",
  csv: "text/csv; charset=utf-8",
};

const PARTIAL_ROW_CHARACTERS = 8;
const DELIVER_SENT_BYTES_BEFORE_DESTROY_MS = 20;

function sendJsonRowsThenPartialRowThenStop(
  res: ServerResponse,
  rows: Array<Record<string, unknown>>,
  interrupt: TableInterruption,
): void {
  if (interrupt.rowsBeforeFailure === 0) {
    res.flushHeaders();
  } else {
    const sent = rows
      .slice(0, interrupt.rowsBeforeFailure)
      .map((row) => JSON.stringify(row));
    const partialNext = JSON.stringify(
      rows[interrupt.rowsBeforeFailure] ?? {},
    ).slice(0, PARTIAL_ROW_CHARACTERS);
    res.write(`[${sent.join(",")},${partialNext}`);
  }
  if (interrupt.mode === "truncate") {
    res.end();
  } else {
    setTimeout(() => res.destroy(), DELIVER_SENT_BYTES_BEFORE_DESTROY_MS);
  }
}

function trailingLimit(query: string | undefined): number | undefined {
  const match = query?.match(/\bLIMIT\s+(\d+)\s*$/iu);
  return match ? Number(match[1]) : undefined;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
  ]
    .map((line) => `${line}\n`)
    .join("");
}
