import { expect } from "vitest";
import type { RecordedRequest } from "./fake-influxdb.js";

/** Check the reservation against requests observed at the HTTP boundary. */
export function expectRequestsWithinBudget(
  requests: readonly RecordedRequest[],
  budget: { used: number; max: number },
): void {
  expect(requests.length).toBeLessThanOrEqual(budget.used);
  expect(budget.used).toBeLessThanOrEqual(budget.max);
}
