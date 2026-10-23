import type { StructuredQueryResponse } from "../../src/services/query.service.js";

type Metadata = StructuredQueryResponse["metadata"];
declare const shared: Pick<
  Metadata,
  | "request_id"
  | "query_id"
  | "query_id_source"
  | "query_type"
  | "duration_ms"
  | "row_count"
>;
declare function accept(metadata: Metadata): void;

accept({
  ...shared,
  success: true,
  completeness: "complete",
  truncated: false,
});
accept({
  ...shared,
  success: true,
  completeness: "capped",
  truncated: true,
  cap: 3,
  cap_source: "server_bound",
});

accept({
  ...shared,
  success: true,
  // @ts-expect-error Interrupted queries cannot be successful responses.
  completeness: "interrupted",
  truncated: true,
});
// @ts-expect-error A capped response must identify its cap.
accept({
  ...shared,
  success: true,
  completeness: "capped",
  truncated: true,
  cap_source: "query_limit",
});
// @ts-expect-error A capped response must identify the source of its cap.
accept({
  ...shared,
  success: true,
  completeness: "capped",
  truncated: true,
  cap: 3,
});
// @ts-expect-error A capped response is truncated.
accept({
  ...shared,
  success: true,
  completeness: "capped",
  truncated: false,
  cap: 3,
  cap_source: "query_limit",
});
accept({
  ...shared,
  success: true,
  completeness: "complete",
  truncated: false,
  cap: 3,
  // @ts-expect-error A complete response cannot report a cap.
  cap_source: "server_bound",
});
accept({
  ...shared,
  // @ts-expect-error A successful response cannot describe a failed execution.
  success: false,
  completeness: "complete",
  truncated: false,
});
