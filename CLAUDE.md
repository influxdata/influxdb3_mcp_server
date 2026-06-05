# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An MCP (Model Context Protocol) server for InfluxDB 3. It exposes tools, resources, and prompts that let MCP clients (Claude Desktop, etc.) query, write, and manage InfluxDB instances over stdio. Supports five InfluxDB product types: `core`, `enterprise`, `cloud-dedicated`, `cloud-serverless`, `clustered`.

## Commands

```bash
npm run build      # compile TypeScript → build/
npm run lint       # eslint
npm run format     # prettier
npm test           # protocol compliance tests (vitest, no InfluxDB needed)
```

Build before testing — tests spawn the compiled `build/index.js`.
For full testing workflow, see `.claude/skills/testing/`.

For full build/run/Docker/environment setup for Core and Enterprise, see
the skill at `.claude/skills/build-run-core-enterprise/`.

### Environment

Configured via `.env` (copy from `env.*.example`). The `INFLUX_DB_PRODUCT_TYPE`
env var (`core`, `enterprise`, `cloud-dedicated`, `cloud-serverless`, `clustered`)
determines available tools and API behavior. See `src/config.ts` for validation
rules per product type.

## Architecture

### Layers

```
src/index.ts                    ← Entry point: stdio transport
src/server/index.ts             ← Server factory: config → services → MCP handlers
src/config.ts                   ← Env loading + validation (per product type)
src/services/                   ← Domain logic
  influxdb-master.service.ts    ← Facade: orchestrates all services below
  base-connection.service.ts    ← Client init, ping, health, data/management host routing
  http-client.service.ts        ← Axios wrapper with product-type-aware auth headers
  query.service.ts              ← SQL query execution, schema discovery
  write.service.ts              ← Line protocol writes
  database-management.service.ts
  token-management.service.ts   ← Core/Enterprise token CRUD
  cloud-token-management.service.ts ← Cloud Dedicated/Clustered token CRUD
  serverless-schema-management.service.ts
  help.service.ts
  context-file.service.ts       ← Loads user context from context/ directory
src/tools/                      ← MCP tool definitions
  index.ts                      ← Aggregates all tool categories
  categories/*.tools.ts         ← Each file defines tools with Zod schema + handler
src/resources/index.ts          ← MCP resources (config, status, databases, context)
src/prompts/index.ts            ← MCP prompt templates
src/helpers/enums/              ← InfluxProductType enum
```

### Key Patterns

- **Product-type branching**: Many operations behave differently per product type. `BaseConnectionService` separates data-plane vs management-plane hosts. `validateOperationSupport()` gates tools to supported product types. Auth headers differ (`Token` for cloud-serverless, `Bearer` for others).
- **Dual-plane architecture for cloud-dedicated/clustered**: Data operations use the cluster host (`{cluster_id}.a.influxdb.io`), management operations use `console.influxdata.com`. The `clustered` type uses dummy IDs for compatibility with cloud-dedicated handlers.
- **Tool structure**: Each tool in `src/tools/categories/` exports a `createXTools(influxService)` function returning `McpTool[]`. Each tool has both a JSON Schema `inputSchema` (for MCP protocol) and a `zodSchema` (for runtime validation in `server/index.ts`). Keep these in sync.
- **All logging goes to stderr** (`console.error`/`console.warn`), since stdout is the MCP stdio transport.

## Conventions

- ESM modules (`"type": "module"` in package.json), `.js` extensions in all imports (even for `.ts` files — required by Node16 module resolution)
- TypeScript strict mode, target ES2022
- Unused vars prefixed with `_` (eslint configured to allow this)
- `@typescript-eslint/no-explicit-any` is disabled — the codebase uses `any` freely
- Tests use vitest; `tests/` is compiled by vitest's Vite pipeline, not `tsc` (separate from `tsconfig.json`)
