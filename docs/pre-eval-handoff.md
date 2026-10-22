# Pre-eval checkpoint: October 22, 2026

Work is paused before capability evals. No release was tagged or published.
PR #140 remains a draft. Use this checkpoint's commit as the next candidate,
subject to CI and runner preflights.

## Changes included

- Integrated dependency PRs #143–#146 and the formatted release criteria from
  #137 into the candidate branch. The separate #137 branch has green CI at
  `cdf5640`; it hasn't merged to `main`.
- Aligned package, lockfile, runtime, Registry metadata, and changelog versions
  at 2.0.0. The changelog explains that existing response-contract changes
  require the major version; database compatibility alone doesn't.
- Updated migration guidance and included the referenced output-contract
  document in the npm package.
- Updated Vitest to 4.1.12, Vite to 8.3.5, and ip-address to 10.7.4.
  The final npm audit reported zero vulnerabilities.
- Added reusable `verify:candidate`, `verify:artifacts`, and `smoke:server`
  commands. See [Release verification](release-verification.md).
  These commands use the existing build, test, version check, and Dockerfile.

## Verification completed

Evidence is saved in `e2e-results/2026-10-22-release-prep/`.
The digest manifest identifies verified runtime files and manifests.

- `npm run verify:candidate`: lint, format, versions, build, and tests passed.
  Tests: 297 passed, 25 skipped. An earlier sandboxed attempt timed out because
  fake-server tests need local network access; the unsandboxed rerun passed.
- Live Core 3.12.1: 271 passed, 51 skipped.
- Live Enterprise 3.12.1: 275 passed, 47 skipped.
- Expired-JWT acceptance: passed on the current runtime candidate.
  Signature and expiration were checked without recording credentials.
- `verify:artifacts`: clean npm tarball installation and Docker checks passed
  for Core and Enterprise across readonly, readwrite, and operator profiles.
  The final shared Docker smoke check also passed with the image's default
  non-root user. An initial checker incorrectly assumed readwrite excluded
  administration tools; the assertion now matches existing behavior.
- Registry lookup found no published npm version 2.0.0 at verification time.

Artifact logs record package integrity and local image IDs. Scripts and this
handoff aren't shipped in the npm tarball. No production behavior changed after
the recorded live checks; later changes consolidated verification scripts.

## Next steps

1. Check CI on the pushed checkpoint, including Cloud Serverless integration
   and Registry metadata validation. Update #140's description to include the
   dependency integrations, 2.0.0 migration, and reusable verification commands.
2. Complete runner authentication and model-access preflights in the operator's
   authenticated terminal. Agent subprocess authentication is still blocked;
   don't treat terminal sign-in as proof that the runner can launch.
3. Pin the case selection explicitly before running the planned comparison.
   The current expanded manifest would produce 150 runs with both harnesses
   and three repeats. The original selection is 15 server/case combinations,
   or 90 runs across both harnesses and three repeats.
4. Record exact server and runner commits, model identities, prompts, database
   image IDs, and fixture state for both baseline and candidate. Historical
   Codex runs with unknown actual models need fresh evidence. Historical Core
   fixture counts also differ, so those groups aren't directly comparable.
5. Run and grade the final comparison only after those gates pass. Preserve
   completion rates, graded pass rates, and pending reviews separately.
6. Complete release review and merge only after capability acceptance. Then
   follow the release skill for tagging, environment approvals, Platform
   Services signoff, and exact-version artifact verification.

Server timeout/backpressure classifications still need live observations.
Partial per-table denial and failures after streaming begins retain fake-only
coverage. Keep those limits explicit; no speculative classifications were added.
Write-path #125 and execute_query deprecation #142 remain deferred.
