Databases available: `_internal`, `home`, `host_system`, `loadcap_probe`, `smoke`.

**Assumption:** no db is named exactly `system_host` — used `host_system` as the closest match.

Latest metrics from the `metrics` table in `host_system` (single `metrics` table, per-host CPU/mem/disk fields):

| time (UTC) | host | cpu idle % | cpu system % | cpu user % |
|---|---|---|---|---|
| 2026-07-23T17:27:45 | e2e-host-1 | 84.3 | 3.2 | 12.5 |
| 2026-07-23T17:27:45 | e2e-host-2 | 45.2 | 9.7 | 45.1 |
| 2026-07-23T17:25:38 | e2e-host-1 | 84.3 | 3.2 | 12.5 |
| 2026-07-23T17:25:38 | e2e-host-2 | 45.2 | 9.7 | 45.1 |

Two hosts reporting (`e2e-host-1`, `e2e-host-2`), values static across recent samples — looks like a simulated/test data source. Let me know if you want mem/disk fields or a longer time range.
