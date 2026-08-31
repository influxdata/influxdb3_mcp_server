# Session log: building the Parquet→PachaTree hybrid fixture (E2/E3/P6)

**Date:** 2026-08-30, addendum 2026-08-31
**Goal:** Resolve verification questions E2 and E3 from `verification-questions.md` §5 by
building a real Enterprise fixture that starts in Parquet mode, gets upgraded to the PachaTree
storage engine via `--upgrade-pacha-tree`, and lets us observe the hybrid state live against a
Docker cluster.

This log includes a real mistake and its correction, in full, because that's more useful to a
reader than a cleaned-up version would be: the mistake (querying the wrong database) produced
symptoms — "the table doesn't exist," "the migration is too fast to catch" — that looked exactly
like a product finding, and were confidently written up as one before a second pair of eyes
caught it. That gap between "the evidence I collected" and "what's actually true" is the thing
worth showing.

---

## Starting assumption, and why it broke immediately

The plan going in, per `PLAN.md`, was: start an Enterprise container without any PachaTree
flag, write some data (Parquet mode), then restart it with `--upgrade-pacha-tree` and watch the
hybrid window.

First surprise: **`--use-pacha-tree` isn't documented anywhere in `--help` or `--help-all`.**
Initial read: "this flag doesn't really do anything, PachaTree is just always the default now."
That's half right — PachaTree genuinely is the unconditional default for new 3.11 clusters —
but the flag itself is real. The release notes say so directly: *"The previous flag,
`--use-pacha-tree`, still works but is deprecated."* It's a no-op in effect (it selects the
engine that's already selected), not a no-op because it was invented. **Lesson, stated plainly
because it recurs three more times in this log: absence from `--help`/`--help-all` on this CLI
means "deprecated or new enough to be undocumented," not "doesn't exist."**

Since a flag to force Parquet mode wasn't (yet, correctly) known, the fallback plan was to
originate data on a pre-3.11 image (`influxdb:3.10.0-enterprise`) and bring that data directory
up on 3.11.2 with `--upgrade-pacha-tree`. That plan worked, and is documented below, but it
turned out to be more work than necessary — see the `--use-parquet` correction further down.

---

## Building the two-phase fixture

Added a new service to docs-tooling's `docker-compose.yml`:
`influxdb3-enterprise-verify-upgrade`, with its own volume and cluster identity
(`verify-upgrade0`) isolated from the existing trial-licensed clusters.

### Licensing: the third quota ran out fast

docs-tooling has exactly two Enterprise license identities that don't need a fresh trial-email
verification round-trip, and both are already bound to other clusters — a new `cluster-id`
under either returns `TrialExpired`. The unclaimed slot was the **Home license**
(`--license-type=home`, `core_count=2`, single node only) — which fits this fixture anyway,
since it's single-node. It still needs `--license-email` passed explicitly even with
`--license-type=home`: omit it and the server fails with `No interactive TTY detected. Cannot
prompt for email.` instead of picking a sane default.

### Getting data to actually reach disk

Wrote 10,000 points, queried them back successfully — and found zero Parquet files on disk.
`SELECT count(*)` was answering entirely from the WAL buffer; the default `--gen1-duration` is
10 minutes, and nothing forces an earlier snapshot from a handful of writes with no further
activity. Fix: `--wal-files-per-snapshot=1` forces a snapshot after every single new WAL file.
One catch — it only affects WAL files written *after* the flag is live; replaying already-
written WAL on restart doesn't retroactively trigger a snapshot.

### The Docker Desktop port-publish gotcha

Unrelated to InfluxDB, but cost real time: `docker run -p 8483:8181` silently produced a broken
port mapping (`docker inspect` showed `PortBindings: [{invalid IP 8483}]`), and the port was
unreachable from the host despite the container serving fine on its internal Docker-network IP.
Fix: always specify the host IP explicitly, `-p 0.0.0.0:8483:8181`. Compose's own `ports:`
mapping syntax was unaffected. Simplest long-term workaround: skip host-port publishing
entirely and query through a throwaway container on the same Docker network.

---

## The mistake: concluding the tables don't exist and the window can't be caught

With the fixture running, I queried `system.upgrade_parquet_node` and `system.upgrade_parquet`
against the database being migrated (`upgrade_test`). Every query, at every point before,
during, and after the migration, returned:

```
Error during planning: table 'public.system.upgrade_parquet_node' not found
```

I cross-checked `information_schema.tables` for `table_schema = 'system'` against the same
database — 23 tables listed, neither `upgrade_parquet` name among them — and treated that as
confirmation. I also checked `influxdb3 serve --help-all` for `--upgrade-poll-interval` and
didn't find it. Both checks *looked* thorough. Both were checking the wrong thing.

From there I built a full, superficially rigorous case: two live runs (10,000 and 200,000
rows), a 300ms polling loop through a network-local helper container to strip out round-trip
overhead, log-timestamp analysis showing the bulk importer completing in under 1.3 seconds
either way. All of that was real data, honestly collected. It supported a wrong conclusion,
because **the tables live in the `_internal` database, not the database being migrated** — a
fact that never showed up in anything I checked, because I never queried `_internal`.

The write-up that went out first stated flatly that a previous verification pass (question B3)
had been wrong to call these tables "documented and sanctioned," and updated the tracking
document to say so. B3 was correct. This session's first pass was the one that was wrong, and
it took a second opinion — someone actually checking the public docs and a real user's forum
post — to catch it.

**What made the mistake convincing from the inside:** every individual check I ran actually
passed. The query genuinely returned "table not found." The schema listing genuinely didn't
include those names. The timing measurements were real. Rigor at the level of "run enough
checks and read the logs closely" doesn't protect against a wrong premise sitting underneath
all of them — in this case, "which database" — because every check I thought to run shared that
same premise.

---

## The correction, once caught

Re-querying the exact same (already-completed) fixture against `_internal` instead:

```sql
SELECT * FROM system.upgrade_parquet_node;
-- [{"node_id":"node0","mode":"ingest","status":"completed", ...},
--  {"node_id":"node0","mode":"compactor","status":"completed", ...}]

SELECT status, COUNT(*) AS files FROM system.upgrade_parquet GROUP BY status;
-- [{"status":"compacted","files":16}]
```

Both tables were there the whole time. Rebuilt the experiment properly — fresh fixture, correct
database, tight polling from the moment the upgrade container started — and this time caught
the live transition:

```
16:20:09.19  ingest=completed  compactor=upgrading
16:20:10.29  ingest=completed  compactor=upgrading
16:20:11.57  ingest=completed  compactor=upgrading
16:20:12.43  ingest=completed  compactor=completed
```

A real, several-second hybrid window, sitting in plain sight the entire time — invisible only
because the first pass never asked the database that had the answer.

### `--upgrade-poll-interval` is also real, and it does what it says

Checking `--help-all` again for this flag repeated the exact same mistake pattern as
`--use-pacha-tree`: absent from help text, assumed fake. It isn't. Passing
`--upgrade-poll-interval=15s` and re-running the same 200,000-row migration:

```
default (5s):   compactor "upgrading" held ~3s,  → completed
--upgrade-poll-interval=15s: compactor "upgrading" held ~13s, → completed
```

The window width tracks the poll interval closely. Raising this flag is a legitimate,
documented way to widen the hybrid window for a test that needs to observe it — which directly
answers the original E2 question, in the opposite direction from the first draft's answer.

### `--use-parquet` — the flag that would have skipped the pre-3.11 image entirely

The same undocumented-but-real pattern applies a third time. `3.11.2` added `--use-parquet`
(env `INFLUXDB3_USE_PARQUET`), specifically so engineers could build exactly this kind of
side-by-side upgrade test without needing an old image. It doesn't appear in `--help`/
`--help-all` either. Rebuilding the fixture with it confirmed it works: `influxdb:3.11.2-
enterprise ... --use-parquet` starts genuinely Parquet-mode, no 3.10.0 image required. The
two-phase fixture is now: same image, same volume, drop `--use-parquet` and add
`--upgrade-pacha-tree` for phase 2.

**Pattern across all three:** this CLI hides deprecated flags and options newer than the
current release's public docs from both `--help` and `--help-all` alike. Neither help output is
a reliable signal that a flag doesn't exist. Where it matters, check the release notes or ask
before writing "isn't a real flag" into a doc.

---

## Final results

- **E2 — resolved, correctly this time.** `system.upgrade_parquet_node` /
  `system.upgrade_parquet` are real, live-confirmed, queried against `_internal`.
  `--upgrade-poll-interval` is real and controls the hybrid window's width (measured, not
  assumed: ~3s at the 5s default, ~13s at `15s`). `--use-parquet` is the simple way to build a
  fresh Parquet-mode 3.11.2+ cluster for this kind of test. Data integrity held exactly across
  every migration run (10,001 and 200,000 rows, no loss or duplication).
- **E3 — resolved.** Plain `--mode all` (the default) was sufficient throughout; no
  session-secret or webui requirement encountered in any run.
- **B3 — reaffirmed as originally resolved**, after this session's first pass incorrectly
  flagged it wrong.

## What changed as a result

- **`docs-tooling/docker-compose.yml`** — added the `influxdb3-enterprise-verify-upgrade`
  service and its volume.
- **`verification-questions.md`** — §5 rewritten with the corrected E2/E3 resolution, the
  working two-phase commands (now using `--use-parquet`), and the note that this session's own
  first pass had B3 backwards; B3's closed-questions entry restored to its original resolution
  with a live-confirmation note added.
- **This file** — rewritten to keep the mistake in, not just the corrected answer.

## Material for a docs page or blog post

1. **The "undocumented flag" trap is the real story here, more than the storage engine
   itself.** `--use-pacha-tree`, `--upgrade-poll-interval`, and `--use-parquet` are all real,
   all absent from `--help`/`--help-all` on 3.11.2, for three different reasons (deprecated,
   documented-but-CLI-help-lags, and new-in-this-release). A short docs note — "CLI help output
   on this build doesn't list every accepted flag; check the release notes or the config
   reference before concluding a flag doesn't exist" — would have saved this entire detour.
2. **`system.upgrade_parquet_node` and `system.upgrade_parquet` live in `_internal`, not the
   database being migrated.** This is exactly the kind of thing worth a one-line callout on the
   docs page showing these queries, since the failure mode (querying the wrong db) produces an
   error message indistinguishable from "the table doesn't exist."
3. **The hybrid window is real, short by default, and tunable.** At a couple hundred thousand
   rows, the default configuration gives you a few seconds; `--upgrade-poll-interval` widens
   that on request. That's a genuinely useful, concrete operational fact for anyone planning to
   script a test — or just wanting to know what to expect — around a real upgrade.
4. **A forum thread and an internal support case, cross-checked independently, are what caught
   this.** A user running the exact same upgrade in production, and this session running it
   fresh in Docker, converged on the same corrected facts from two different directions. That's
   a stronger signal than either alone.

---

## Addendum, 2026-08-31: P6 — running the correctness checks inside the window

With the mechanics fixed (correct database, `--upgrade-poll-interval` widening the window),
the actual purpose of building this fixture — P6, checking whether anything behaves
differently while a database is mid-migration — was still unrun. Did it this session, once the
window-catching approach was solid.

One more environment wrinkle on the way there: a long-lived helper container (`sleep 3600`,
used to query the server without fighting Docker Desktop's flaky host-port publishing) died
mid-experiment. `docker inspect` showed `ExitCode: 0` — it hadn't crashed, its hour had simply
elapsed. The gap between issuing commands in this session and their landing in real wall-clock
time turned out to be longer than an hour more than once. Anything meant to outlive a single
step of a multi-step live test needs `sleep infinity`, not a duration guessed at the start.

**With that fixed, caught the window reliably** (`--upgrade-poll-interval=25s`, `_internal`'s
`compactor` row read `upgrading` within ~2 seconds of triggering the upgrade) and ran all four
P6 checks inside it:

- `get_measurements`/`get_measurement_schema` equivalents returned identical structure and
  types to the pre-upgrade Parquet-mode schema — no drift.
- A duplicate-tag-key write issued mid-migration came back with the exact same error shape
  already recorded in `tests/fixtures/write-errors.ts` from an earlier Parquet-mode run:
  `data.error: "partial write of line protocol occurred"`, with the actionable detail one level
  down in `data[].error_message`. That fixture's own comment noted it had already been checked
  against an Enterprise cluster mid-`--upgrade-pacha-tree` once before (3.11.0-0.rc.1) — this
  reconfirms it on 3.11.2 with a window that was easier to hit deliberately, rather than by
  accident.
- A point written while the compactor row still read `upgrading`, then queried after the window
  had closed alongside the original Parquet-origin data, came back correct and exactly
  once — no loss, no duplication, no visible seam at the boundary.

Nothing broke. The most interesting result of P6 is negative: an MCP client talking to a
database mid-migration would see nothing different from talking to a database on either side of
it. That's worth stating in the docs as a plain reassurance, not just a checkbox — it's the kind
of thing that's easy to worry about in the abstract and straightforward to demonstrate in
practice, once you're not accidentally checking the wrong database.
