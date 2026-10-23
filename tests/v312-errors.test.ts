/**
 * InfluxDB 3.12 write/query error classification (Core/Enterprise, axios).
 *
 * Explicit schema rejections, WAL backpressure (429), query memory exhaustion,
 * query nodes (405), and read-only token denials (403).
 */

import { describe, it, expect, vi } from "vitest";
import { InfluxProductType } from "../src/helpers/enums/influx-product-types.enum.js";
import { QueryService } from "../src/services/query.service.js";
import { WriteService } from "../src/services/write.service.js";
import { errorResponse } from "../src/tools/response.js";
import {
  httpClientThrowing,
  stubBaseService,
} from "./helpers/write-service.js";
import type { AxiosErrorShape } from "./fixtures/error-responses.js";
import {
  ENT_400_EXPLICIT_UNDECLARED_FIELD_NO_PARTIAL,
  ENT_400_EXPLICIT_UNDECLARED_FIELD_PARTIAL,
  ENT_400_EXPLICIT_UNDECLARED_TABLE,
  ENT_403_READ_TOKEN_OTHER_DB,
  ENT_403_READ_TOKEN_WRITE,
  QUERY_405_NO_QUERY_MODE,
  QUERY_429_TOO_MANY_REQUESTS,
  QUERY_500_RESOURCES_EXHAUSTED,
  WRITE_429_WAL_BUFFER_FULL,
} from "./fixtures/v312-errors.js";

async function writeError(error: AxiosErrorShape): Promise<any> {
  const base = stubBaseService(InfluxProductType.Enterprise);
  vi.mocked(base.getInfluxHttpClient).mockReturnValue(
    httpClientThrowing(error) as any,
  );
  try {
    await new WriteService(base).writeLineProtocol("t,host=a usage=1", "db1", {
      precision: "nanosecond",
    });
  } catch (e) {
    return e;
  }
  throw new Error("expected the write to reject");
}

async function queryError(error: AxiosErrorShape): Promise<any> {
  const base = stubBaseService(InfluxProductType.Enterprise);
  vi.mocked(base.getInfluxHttpClient).mockReturnValue(
    httpClientThrowing(error) as any,
  );
  try {
    await new QueryService(base).executeQuery("SELECT * FROM t", "db1");
  } catch (e) {
    return e;
  }
  throw new Error("expected the query to reject");
}

describe("write: explicit schema rejections (Enterprise 3.12)", () => {
  it("undeclared table keeps the server text and adds a declare-first hint", async () => {
    const err = await writeError(ENT_400_EXPLICIT_UNDECLARED_TABLE);
    expect(err.message).toMatch(/^Bad request: table 'nope' is not defined/);
    expect(err.message).toContain("explicit schema");
    expect(err.message).toMatch(/\/api\/v3\/configure\/table/);
    expect(err.message).toMatch(/no tool/i);
    expect(err.code).toBe("write_schema_not_declared");
    expect(err.retryable).toBe(false);
  });

  it("partial write names the rejected lines and says the rest were written", async () => {
    const err = await writeError(ENT_400_EXPLICIT_UNDECLARED_FIELD_PARTIAL);
    expect(err.message).toContain("column 'bogus'");
    expect(err.message).toMatch(/other lines .*were written/i);
    expect(err.message).toMatch(/rejected line numbers: 2\b/);
  });

  it("accept_partial=false: says nothing was written", async () => {
    const err = await writeError(ENT_400_EXPLICIT_UNDECLARED_FIELD_NO_PARTIAL);
    expect(err.message).toContain("column 'bogus'");
    expect(err.message).not.toMatch(/other lines .*were written/i);
    expect(err.message).toMatch(/no lines .*written/i);
  });
});

describe("write: backpressure and denial", () => {
  it("429 WAL buffer full is retryable backpressure with the server text", async () => {
    const err = await writeError(WRITE_429_WAL_BUFFER_FULL);
    expect(err.message).toMatch(
      /^Too many requests, retry the write after a short backoff: /,
    );
    expect(err.message).toContain("wal buffer is full");
    expect(err.code).toBe("write_backpressure");
    expect(err.retryable).toBe(true);
  });

  it("403 with an empty body explains the token can't write, not retryable", async () => {
    const err = await writeError(ENT_403_READ_TOKEN_WRITE);
    expect(err.message).toMatch(/^Access denied: /);
    expect(err.message).toMatch(/write permission.*'db1'/);
    expect(err.message).toMatch(/do not retry/i);
    expect(err.code).toBe("access_denied");
    expect(err.retryable).toBe(false);
  });
});

describe("query: 3.12 error classes", () => {
  it("Resources exhausted (HTTP 500 at RC-2) is retryable after narrowing", async () => {
    const err = await queryError(QUERY_500_RESOURCES_EXHAUSTED);
    expect(err.message).toMatch(/memory/i);
    expect(err.message).toMatch(/narrow/i);
    expect(err.message).toContain("Resources exhausted");
    expect(err.code).toBe("query_resources_exhausted");
    expect(err.retryable).toBe(true);
  });

  it("429 is retryable backpressure", async () => {
    const err = await queryError(QUERY_429_TOO_MANY_REQUESTS);
    expect(err.message).toMatch(/^Too many requests/);
    expect(err.message).toContain("overloaded");
    expect(err.code).toBe("query_backpressure");
    expect(err.retryable).toBe(true);
  });

  it("405 no-query-mode tells the caller to use a query node", async () => {
    const err = await queryError(QUERY_405_NO_QUERY_MODE);
    expect(err.message).toMatch(/^Method not allowed: /);
    expect(err.message).toMatch(/query node/);
    expect(err.message).toMatch(/INFLUX_DB_INSTANCE_URL/);
    expect(err.code).toBe("query_node_required");
    expect(err.retryable).toBe(false);
  });

  it("403 read-only token on another database: clear, non-retryable", async () => {
    const err = await queryError(ENT_403_READ_TOKEN_OTHER_DB);
    expect(err.message).toMatch(/^Access denied: Forbidden/);
    expect(err.message).toMatch(/not authorized for database 'db1'/);
    expect(err.message).toMatch(/list_databases/);
    expect(err.code).toBe("access_denied");
    expect(err.retryable).toBe(false);
  });
});

describe("errorResponse carries retryable", () => {
  it("reflects error.retryable in the tool payload", () => {
    const err: any = new Error("boom");
    err.retryable = true;
    const payload = JSON.parse(errorResponse(err, "x").content[0].text);
    expect(payload.error.retryable).toBe(true);
  });

  it("defaults to false", () => {
    const payload = JSON.parse(
      errorResponse(new Error("boom"), "x").content[0].text,
    );
    expect(payload.error.retryable).toBe(false);
  });
});
