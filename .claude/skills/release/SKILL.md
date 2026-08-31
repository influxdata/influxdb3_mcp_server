---
name: Release
description: >-
  This skill should be used when the user asks to "cut a release", "publish a
  new version", "tag vX.Y.Z", "release the MCP server", or needs to bump the
  version and ship it. Covers the version-bump PR, tagging, and publishing the
  GitHub release; npm and Docker Hub publish run automatically from there.
version: 0.1.0
---

# Releasing influxdb3_mcp_server

npm publish and Docker Hub publish are automated by
`.github/workflows/release-publish.yml`, triggered when a GitHub release is
published. Both jobs are gated behind a protected GitHub Environment
(`npm-publish`, `docker-publish`) — nothing publishes until the assigned
reviewer approves that job in the Actions tab. There are no manual
`npm publish` / `docker push` steps; don't run them by hand.

## Steps

1. **CI green on `main`.** Don't proceed past a red `main`.
2. **One PR: version bump + changelog + README.** Bump `version` in
   `package.json` and `src/config.ts` (`server.version`) — CI's
   version-consistency check fails the PR if these two and the top
   `CHANGELOG.md` entry don't all match. Also check `README.md` (tool table,
   usage examples) against what actually shipped — easy to forget, has been
   missed before. Merge to `main` before tagging.
3. **Tag** the merge commit from a clean `main` checkout:
   ```
   git fetch origin && git checkout main && git pull --ff-only
   git tag -a vX.Y.Z <merge-commit-sha> -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. **Publish the release:**
   ```
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <path>
   ```
   This fires the release-publish workflow.
5. **Approve the environment gates** in the Actions run: one for npm, one
   for Docker Hub. **Docker Hub publish requires sign-off from Platform
   Services Team** — ping them instead of approving that gate directly.

## Test releases

Use a prerelease version (e.g. `vX.Y.Z-test.1`) to exercise the pipeline
without touching production `latest`: npm publishes under the `prerelease`
dist-tag, and Docker Hub only gets the `<version>` tag — `latest` is
untouched on both registries for any version containing a `-`.
