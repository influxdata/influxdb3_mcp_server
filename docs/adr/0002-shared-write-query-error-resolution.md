# ADR 0002: Shared error resolution for the write and query paths

- Status: Accepted (implemented for the write path in the 1.4.1 patch)
- Date: 2026-09-01

## Context

`WriteService.handleWriteError` and `QueryService.handleQueryError`
(`src/services/write.service.ts`, `src/services/query.service.ts`) both
convert a thrown HTTP error into the error message returned to the MCP
client. The two implementations diverged. `handleQueryError` resolves the actual InfluxDB
error body (`data.message` → `data.error` → string body → `statusText` →
`error.message`). `handleWriteError` matched only on
`error.response?.status` and threw a fixed string per status; the response
body was discarded. Its fallback interpolated `error.response?.data`
directly, which rendered a parsed JSON body as `[object Object]`.

InfluxDB 3.11 rejects a duplicate-tag-key write with a body that names the
tag, nested under `data.data[].error_message`. The fixed 400 string
discarded that body, so the tag name was not returned to the client. Neither
handler had a 503 arm. The two write-capable transports throw different
error shapes: axios (`error.response.status`/`.data`) for
Core/Enterprise/Clustered, and the InfluxDB SDK's `HttpError`
(`error.statusCode`, `error.json`/`.body`) for Cloud Dedicated/Serverless.
`handleWriteError` matched only the axios shape, so cloud write errors
always fell through to the fallback.

Three other services preserve error bodies with their own separate
implementations: `token-management.service.ts`,
`database-management.service.ts`, `cloud-token-management.service.ts`.

## Decision

Extract the shared logic into `src/services/error-resolution.service.ts`:

- `normalizeError(error)` converts the axios shape and the SDK `HttpError`
  shape to one `{ status, body }` form.
- `resolveErrorMessage(body, fallback)` resolves the error message from a
  body: the write path's partial-write shapes first, then the query path's
  existing resolution order, then `fallback`.

`handleWriteError` calls both and switches on the normalized status,
including a new `503` arm phrased as retryable. `handleQueryError` and the
three token/database services are unchanged in this patch. The helper's
default resolution order already matches `handleQueryError`'s current
behavior, so migrating it, and the other three services, is deferred to a
later change.

## Consequences

- One function defines the write path's error-body resolution for all five
  product types, instead of five status arms each with its own field
  access.
- A future status code that needs a body-preserving arm extends
  `resolveErrorMessage`'s resolution order once, for both paths.
- `handleQueryError` and the three token/database services keep their own
  implementations. That is a known follow-up, not a regression introduced
  by this change.
