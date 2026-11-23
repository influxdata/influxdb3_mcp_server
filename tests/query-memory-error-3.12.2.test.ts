import { describe, expect, it } from "vitest";
import { resolveOperationError } from "../src/services/error-resolution.service.js";
import {
  CORE_429_QUERY_MEMORY_PERSISTED_SORT,
  CORE_500_QUERY_MEMORY_DEDUPLICATE,
  ENT_429_QUERY_MEMORY_EXTERNAL_SORT_1MB,
  ENT_429_QUERY_MEMORY_SORTING,
  ENT_429_QUERY_MEMORY_SPILL_POOL,
} from "./fixtures/query-errors-3.12.2.js";

describe("query memory exhaustion on 3.12.2 (claims 20261120-0024, 0037, 0038)", () => {
  it.each([
    ["Core 500, deduplicate path", CORE_500_QUERY_MEMORY_DEDUPLICATE],
    [
      "Core 429, sorted query over persisted Parquet data",
      CORE_429_QUERY_MEMORY_PERSISTED_SORT,
    ],
    [
      "Enterprise 429, external sort at 1 MB, where 'Resources exhausted' is on line 3",
      ENT_429_QUERY_MEMORY_EXTERNAL_SORT_1MB,
    ],
    ["Enterprise 429, sorting", ENT_429_QUERY_MEMORY_SORTING],
    ["Enterprise 429, spill pool", ENT_429_QUERY_MEMORY_SPILL_POOL],
  ])("asks to narrow the query: %s", (_case, fixture) => {
    const error = resolveOperationError(fixture);
    expect(error.recovery).toBe("narrow");
    expect(error.status).toBe(fixture.response.status);
  });
});
