# Enterprise user-based authentication — design

**Date** 2026-06-10
**Status** Approved (design); pending verification against InfluxDB 3 Enterprise v3.10-rc
**Reference** influxdata/influxdb_pro PR #3781 (merged; ships in v3.10)

## Summary

Let the MCP server authenticate to InfluxDB 3 Enterprise as a user with
username and password, instead of a static token. The server exchanges
credentials for a short-lived JWT access token plus a refresh token via
`POST /api/v3/authorize`, keeps the access token fresh for the life of the
session, and acts with that user's permissions.

This is a transport-level change. It adds zero MCP tools. The agent never
sees or handles JWTs. The change addresses the single-shared-token weakness
named in the AI Tooling Companion Brief (Gap 3, §6): each server instance
runs as a specific user rather than one all-powerful token.

## Scope

In scope:

- Username/password login (`POST /api/v3/authorize`)
- Access-token refresh (`POST /api/v3/authorize/refresh`), with re-login
  fallback when the refresh token is rejected
- Configuration and validation for the new credentials
- Auth mode reported (without secrets) in the existing status resource

Out of scope (deliberate):

- User and role management tools (create/list/update/delete users, role
  assignment). Separate effort.
- Role authoring. PR #3781 says it must not be publicly documented yet.
- OAuth device-code login (`GET /api/v3/auth/oauth/config`).
- `POST /api/v3/configure/user` (init-admin bootstrap) and
  `POST /api/v3/authorize/reset-password`.
- Core (OSS). PR #3781 scopes these endpoints "Ent / OSS" but OSS support
  lands only when code is copied from `ent/` to `oss/`. The product-type
  gate makes Core a one-line addition later.

## Wire contract (from PR #3781, `influxdb3_types/src/http/enterprise.rs`)

All JSON fields are camelCase.

`POST /api/v3/authorize` (unauthenticated)

```json
// request
{ "username": "alice", "password": "..." }
// response
{ "token": "<jwt>", "refreshToken": "...", "userId": 123, "expiresAt": 1760000000 }
```

`POST /api/v3/authorize/refresh`

```json
// request
{ "refreshToken": "..." }
// response: same shape as authorize
```

Verified in server source (`ent/influxdb3_server/src/http/users.rs`):

- `expiresAt` is epoch **seconds** (`time_provider.now().timestamp() +
  JWT_EXPIRATION_SECONDS`).
- Access-token TTL is `JWT_EXPIRATION_SECONDS = 3600` (1 hour).
- Refresh uses `validate_and_rotate_refresh_token`: each refresh consumes
  the old token and issues a new one.
- Both endpoints return an `UsersNotEnabled` error when the server's user
  service or JWT authority is not configured, so user auth requires
  server-side enablement.

## Configuration

New env vars: `INFLUX_DB_USERNAME`, `INFLUX_DB_PASSWORD`.
`InfluxConfig` gains optional `username` and `password` fields.

Validation (in `validateConfig`):

| Condition | Result |
|---|---|
| Enterprise, token only | OK (unchanged behavior) |
| Enterprise, username + password only | OK (user-auth mode) |
| Enterprise, token AND credentials | Error: "Both INFLUX_DB_TOKEN and INFLUX_DB_USERNAME/INFLUX_DB_PASSWORD are set. Set exactly one." |
| Enterprise, username XOR password | Error naming the missing variable |
| Enterprise, neither | Existing error, extended to mention the credential option |
| Any other product type with credentials set | Error: user auth is Enterprise-only |

Fail-fast on ambiguity was an explicit decision: silently picking an
identity is worse than refusing to start.

## Components

### UserAuthService (new, `src/services/user-auth.service.ts`)

Single owner of auth state. Holds credentials (from env), current access
token, refresh token, `expiresAt`, `userId`, and a token version counter.

Public surface:

- `getToken(): Promise<string>` — login on first call; proactive refresh
  when within a 30-second skew margin of `expiresAt`; concurrent callers
  share one in-flight login/refresh promise.
- `forceRefresh(): Promise<string>` — for the 401 retry path; also
  coalesces concurrent calls.
- `getTokenVersion(): number` — increments on every token change.
- `getAuthInfo(): { username, userId?, expiresAt? }` — for the status
  resource. Never returns token material.

Behavior:

- Refresh failure (401/403 on the refresh endpoint) falls back to full
  re-login with the stored credentials.
- Login is lazy (first operation), matching the existing pattern where
  construction never touches the network.
- Uses its own bare HTTP client for the two auth endpoints to avoid a
  circular dependency with the token-providing client.
- Tokens live in memory only. Nothing is persisted to disk. Tokens and
  passwords never appear in logs or error messages.

### HttpClientService (modified)

- Constructor accepts an optional async token provider in addition to the
  existing static token. Static mode wraps the token in a constant
  provider; behavior for the other four product types is unchanged.
- Request interceptor resolves the token per request and sets
  `Authorization: Bearer <token>` (Enterprise).
- Response interceptor: on 401 in user-auth mode, call `forceRefresh()`,
  retry the request once. A second 401 propagates.

### BaseConnectionService (modified)

- Owns the `UserAuthService` instance when credentials are configured.
- **Capability checks accept credential-backed auth.** Today
  `isValidConfig`, `hasDataCapabilities`, `hasManagementCapabilities`,
  `validateDataCapabilities`, and `validateManagementCapabilities` all
  reduce to `!!(url && token)` for Core/Enterprise, and every query,
  write, database, and token tool calls one of them before doing any work
  (`query.service.ts:47`, `write.service.ts:50`,
  `database-management.service.ts:44`, `token-management.service.ts:56`).
  Without this change, user-auth mode would fail every tool with
  "requires token in configuration" before the login flow runs. The
  Core/Enterprise condition becomes: url present AND (static token, or
  username + password). Cloud branches are unchanged; config validation
  already rejects credentials there. The validators' error messages name
  both auth options for Enterprise.
- `initializeClient()` is gated on the same check. In user-auth mode it
  skips SDK construction (no token exists at startup under lazy login);
  the async `getClient()` builds the client on first use after login.
- `getClient()` becomes `async getClient(): Promise<InfluxDBClient | null>`.
  The SDK takes a static token at construction and has no setter, so the
  method compares the token version and lazily rebuilds the client when the
  token rotated. About six call sites in `query.service.ts` and
  `write.service.ts`, all already async.
- `ping()` and `getHealthStatus()` obtain the token from the provider.
- `getConnectionInfo()` adds `authMode: "token" | "user"`, and `hasToken`
  means "auth is configured" (static token or credentials), not "a static
  token is set".

### Resources (modified)

The config/status resource reports auth mode and username. No secrets.

### Tools

None added, none changed. `EXPECTED_TOOL_COUNT` is unchanged.

## Error handling

- Bad credentials or unreachable host: tool calls fail with a clear error
  naming the user and host, e.g. `User authentication failed for 'alice'
  at https://host:8181: 401 Unauthorized`.
- 404 from `/api/v3/authorize`: add the hint that the server may be older
  than v3.10 or user auth is not enabled.
- Refresh failure triggers silent re-login; the agent sees an error only
  if re-login also fails.
- Error text is scrubbed: axios errors can embed request config, so auth
  errors are rethrown with curated messages, never the raw error object.

## Testing

Layers, following the repo's existing structure:

1. **Protocol tests** (vitest, no InfluxDB): config validation matrix from
   the table above; server starts in user-auth mode and advertises the
   same tool count; capability checks (`hasDataCapabilities`,
   `hasManagementCapabilities`) return true for Enterprise with
   credentials only, so tools reach the login flow instead of failing
   with "requires token in configuration".
2. **Unit tests** (`UserAuthService` with mocked HTTP): first-call login;
   no refresh while fresh; proactive refresh near expiry; concurrent
   coalescing (N parallel `getToken()` → one login); refresh rejection →
   re-login; `forceRefresh` rotates the version counter.
3. **Integration against v3.10-rc** (when released): bootstrap with
   `influxdb3 manage init-admin`, start the server with credentials,
   exercise query/write/database tools end to end, confirm refresh and
   401-retry behavior.

## Assumptions to verify against the release candidate

Resolved from server source (see "Wire contract" above): `expiresAt` is
epoch seconds; access-token TTL is 1 hour; refresh rotation consumes the
old refresh token; user auth requires server-side enablement (the
endpoints error with `UsersNotEnabled` otherwise).

Still to verify on a running instance:

1. Whether `/ping` and `/health` accept the JWT under the `Token` scheme.
   Current code intentionally uses `Token` for v1/v2 compatibility; if the
   JWT requires `Bearer`, those two calls switch scheme in user-auth mode
   only.
2. The HTTP status code of the `UsersNotEnabled` error (affects the
   error-message hint for servers without user auth enabled).
3. The exact server flags and `manage init-admin` bootstrap sequence for
   enabling user auth in the integration environment.

## Decisions log

- Scope: authentication only; management tools deferred. (User decision)
- Ambiguous auth config fails fast. (User decision)
- Zero new MCP tools; purely transport-level. (User decision)
- Token provider with proactive refresh + reactive 401 fallback, over
  reactive-only or login-once. (User decision, recommended option)
- Enterprise-only gate, Core later. (Per PR #3781 scoping)
- Lazy login over eager-at-startup. (Matches existing construction
  pattern; a failed login surfaces in tool errors and ping)
