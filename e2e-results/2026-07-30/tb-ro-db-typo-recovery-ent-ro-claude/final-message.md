**Assumption:** no database is named `system_host`; I used **host_system**, the closest match.

Databases available: `_internal`, `home`, `host_system`, `loadcap_probe`, `smoke`.

Latest metrics from `host_system.metrics` (single table, per-host CPU/mem/disk stats):

| time | host | cpu usage_idle | usage_system | usage_user |
|---|---|---|---|---|
| 2026-07-30 04:26:03 | e2e-host-2 | 45.2 | 9.7 | 45.1 |
| 2026-07-30 04:26:03 | e2e-host-1 | 84.3 | 3.2 | 12.5 |
| 2026-07-23 17:27:45 | e2e-host-2 | 45.2 | 9.7 | 45.1 |
| 2026-07-23 17:27:45 | e2e-host-1 | 84.3 | 3.2 | 12.5 |
| ... | | | | |

Only two hosts (`e2e-host-1`, `e2e-host-2`) show up, with identical repeating values across samples (looks like simulated/test data). Mem and disk fields exist in the schema (`mem::cached/free/used`, `disk::read_bytes/write_bytes`) but weren't populated in these particular rows. Let me know if you want those fields pulled or a different time range/aggregation.
