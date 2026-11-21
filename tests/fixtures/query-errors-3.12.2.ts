import type { AxiosErrorShape } from "./error-responses.js";

const queryMemoryError = (
  status: 429 | 500,
  body: string,
): AxiosErrorShape => ({
  response: {
    status,
    statusText: status === 429 ? "Too Many Requests" : "Internal Server Error",
    data: body,
  },
  message: `Request failed with status code ${status}`,
});

export const CORE_500_QUERY_MEMORY_DEDUPLICATE = queryMemoryError(
  500,
  [
    "External error: Execution error for 'deduplicate batches'",
    "caused by",
    "Not enough memory to continue external sort. Consider increasing the memory limit, or decreasing sort_spill_reservation_bytes",
    "caused by",
    "Resources exhausted: Additional allocation failed for ExternalSorter[0] with top memory consumers (across reservations) as:",
  ].join("\n"),
);

export const ENT_429_QUERY_MEMORY_EXTERNAL_SORT_1MB = queryMemoryError(
  429,
  [
    "Not enough memory to continue external sort. Consider increasing the memory limit, or decreasing sort_spill_reservation_bytes",
    "caused by",
    "Resources exhausted: Additional allocation failed for ExternalSorter[0] with top memory consumers (across reservations) as:",
  ].join("\n"),
);

export const ENT_429_QUERY_MEMORY_SORTING = queryMemoryError(
  429,
  "Resources exhausted: Memory Exhausted while Sorting (DiskManager is disabled)",
);

export const ENT_429_QUERY_MEMORY_SPILL_POOL = queryMemoryError(
  429,
  "Resources exhausted: Memory Exhausted while SpillPool (DiskManager is disabled)",
);
