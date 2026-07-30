## Databases (5 total)
- `_internal`
- `home`
- `host_system`
- `loadcap_probe`
- `smoke`

## CPU Usage (latest, from `host_system.metrics`)

| Time (UTC) | Host | Idle % | System % | User % |
|---|---|---|---|---|
| 2026-07-30 04:26:03 | e2e-host-1 | 84.3% | 3.2% | 12.5% |
| 2026-07-30 04:26:03 | e2e-host-2 | 45.2% | 9.7% | 45.1% |

Both hosts show identical readings across all recent timestamps (e2e-host-2 running much hotter — ~55% total CPU busy vs ~16% for e2e-host-1), suggesting these may be simulated/static test metrics rather than live varying data.
