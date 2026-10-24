# Release criteria

This document defines when to release the standalone InfluxDB 3 MCP server,
how to choose the version number, and how to deprecate. For the release
mechanics (version bump, tag, publish), see `.claude/skills/release/SKILL.md`.

The consumers of this server are agents as well as humans. A change is
_visible_ if it alters what an agent can call, or how an agent decides what to
call.

## What triggers a release

| Change                                                                              | Release?                   | Notes                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Contract change: tool names, parameter schemas, result envelopes, error shapes      | Yes                        | Changes what clients and agents call.                                                          |
| Description change: tool, parameter, or prompt descriptions                         | Yes                        | Changes agent behavior as much as code does. Not a docs tweak. Must pass the capability evals. |
| Security fix                                                                        | Yes, immediately and alone | Don't batch. Don't hold for other changes.                                                     |
| Spec alignment: MCP protocol version support, such as the stateless 2026-07-28 spec | Yes                        |                                                                                                |
| Internal refactor with no change in behavior                                        | No                         | Merge it. Don't release it on its own. It ships with the next release.                         |

## Version numbers

The project follows [Semantic Versioning](https://semver.org/). For an MCP
server, "breaking" is judged from the agent's point of view.

**Major**

- Remove or rename a tool.
- Add a required parameter.
- Change a result shape.
- Change which tools are enabled by default, for example turning a tool group
  from on to off.

**Minor**

- Add a tool.
- Add an optional parameter.
- Materially rewrite a description.

**Patch**

- Fix a bug.
- Clarify an error message while keeping the same structure.

If a change fits more than one level, use the highest.

## Cadence

- **Patches and security fixes:** release on demand.
- **Everything else:** batch non-urgent changes into roughly monthly minor
  releases.
- Don't release more than once per week unless it is a security fix.

### Signs that releases are too frequent

Releases are too frequent when consumers can't absorb them:

- Users install with an unpinned `npx` command or the `latest` tag, so every
  release reaches them immediately, with no chance to review it.
- The tool list changes often enough that agents behave inconsistently between
  sessions.
- Deprecations expire before users notice them.

If any of these hold, slow the cadence before adding process.

## Deprecation window

Deprecate before removing. The window is 90 days or two InfluxDB 3 minor
releases, whichever is longer.

1. Mark the tool or parameter as deprecated in its description and in
   `CHANGELOG.md` under a `Deprecated` heading. Keep behavior unchanged.
2. Ship the deprecation in a minor release.
3. Remove it no sooner than the end of the window, in a major release.

## Release gates

Every release must pass all of these.

1. CI is green on `main`, including the version-consistency check.
2. Protocol tests pass (`pnpm test`), including `EXPECTED_TOOL_COUNT`.
3. For Core and Enterprise changes, integration tests pass against a live
   InfluxDB 3 instance. See `.claude/skills/testing/`.
4. **Capability evals:** task success is measured per client (for example,
   Claude Code, Codex, OpenCode), and success must not drop compared with the
   previous release. This gate is mandatory for any contract or description
   change, so a description edit can't silently lower success rates.
   `AGENT_E2E_TESTS.md` defines the current cases. It is run by hand and has no
   automated pass/fail threshold yet.
5. `CHANGELOG.md` and `README.md` (tool table, examples) match what ships.

A security fix still needs gates 1 and 2. Run gates 3 and 4 when the fix
touches a tool contract or description.

## Install methods and release protection

How users install the server determines how much protection the release
process must provide itself. If most users run an unpinned `npx` command or
the `latest` image, every release reaches them with no review step on their
side, and the gates above are the only protection.

The README's `npx` example uses `npx -y @influxdata/influxdb3-mcp-server`,
which resolves to the `latest` dist-tag at every launch.

### What can and can't be measured

| Source                             | Reports                       | Limit                                                                                                                             |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| npm download API (`api.npmjs.org`) | Downloads per package version | Records the resolved version, not the specifier. `npx pkg` and `npx pkg@1.4.1` look identical. Also counts CI and mirror traffic. |
| Docker Hub                         | Total pulls per repository    | No per-tag counts.                                                                                                                |
| GitHub release assets              | None                          | The project publishes no downloadable assets.                                                                                     |
| The server                         | None                          | Telemetry is local only (`telemetry.service.ts`). Nothing is sent to InfluxData.                                                  |

No source reports the install method directly. The practical proxy is the
distribution of npm downloads by version after a release:

- Downloads move to the new version within days: most users are unpinned.
- Downloads stay on old versions for weeks: most users are pinned or cached.

To collect it, run weekly:

```bash
curl -s https://api.npmjs.org/versions/@influxdata%2Finfluxdb3-mcp-server/last-week
curl -s https://hub.docker.com/v2/repositories/influxdata/influxdb3-mcp-server/ | jq .pull_count
```

Record the output with the date. Compare the version split in the weeks before
and after each release. Until measured, assume users are unpinned.
