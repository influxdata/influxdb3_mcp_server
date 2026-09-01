# ADR 0002: Shared error resolution for the write and query paths

- Status: Accepted (implemented for the write path in the 1.4.1 patch)
- Date: 2026-09-01

## Context

`WriteService.handleWriteError` and `QueryService.handleQueryError` both
turn a thrown HTTP error into the message an MCP client sees, but they
evolved independently and drifted:

- `handleQueryError` (`src/services/query.service.ts`) resolves the actual
  InfluxDB error body: `data.message` → `data.error` → string body →
  `statusText` → `error.message`.
- `handleWriteError` (`src/services/write.service.ts`) matched only on
  `error.response?.status` and threw a fixed string per status, discarding
  the response body entirely. Its fallback interpolated
  `error.response?.data` directly, which rendered a parsed JSON body as
  `[object Object]`.

InfluxDB 3.11 made this concrete: a duplicate-tag-key write is now rejected
up front with a body that names the tag
(`data.data[].error_message`, under the default `accept_partial=true`
partial-write shape). `handleWriteError`'s fixed 400 string threw that body
away, so the one piece of information the rejection exists to convey never
reached the model.

Neither handler had a 503 arm. And the two write-capable product families
throw different shapes on failure: axios (`error.response.status`,
`error.response.data`) for Core/Enterprise/Clustered, and the InfluxDB
SDK's `HttpError` (`error.statusCode`, `error.json`/`error.body`) for Cloud
Dedicated/Serverless. `handleWriteError` only ever tested the axios shape,
so every cloud write error fell through to the fallback regardless of
status.

Three other services already preserve error bodies with their own ad hoc
variants (`token-management.service.ts:81-83`,
`database-management.service.ts:751`,
`cloud-token-management.service.ts:246`), which is more evidence that
copying this pattern by hand, rather than sharing it, is what let the write
and query paths diverge in the first place.

## Decision

Extract the error-normalizing logic into
`src/services/error-resolution.service.ts`, with two functions:

- `normalizeError(error)` — collapses the axios shape and the SDK
  `HttpError` shape into one `{ status, body }` form, so status-branching
  code doesn't need to know which transport threw.
- `resolveErrorMessage(body, fallback)` — resolves the actionable message
  out of a body, checking the write-path's partial-write shapes first
  (`data.data[].error_message` for the array form, `data.data.error_message`
  for the object form — `accept_partial=true` vs. `false`), then falling
  back to the query path's existing order (`data.message` → `data.error` →
  string body → `fallback`).

`handleWriteError` now calls both and switches on the normalized status,
including a new `503` arm phrased as retryable
(`Service temporarily unavailable, retry the write: ...`) so a model can
tell "try again" apart from "your request is wrong." The fallback arm
passes the resolved message through instead of interpolating
`error.response?.data` directly, which fixes the `[object Object]`
rendering as a side effect of the same change.

`handleQueryError` is unchanged in this patch — the helper's default
resolution order already matches what it does today, so adopting it there
is mechanical and deferred rather than bundled into a compatibility-fix
release. The other three services with ad hoc variants are also left as-is;
the helper exists for them to adopt when they're next touched, not as a
forced migration.

## Consequences

- One place defines what "the error body" means for the write path across
  five product types, instead of five status arms hand-copying an axios
  field access each.
- The next status code that needs a body-preserving arm — on either path —
  extends `resolveErrorMessage`'s resolution order once, rather than being
  fixed on write and forgotten on query (or vice versa) again.
- `handleQueryError` and the three token/database services still have their
  own inline variants. They're a known follow-up, not a regression: the
  helper's existence lowers the cost of the next migration but doesn't
  itself close the gap.
