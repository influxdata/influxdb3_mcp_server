/**
 * `system.pt_*` rows, captured verbatim from a live instance.
 *
 * Source: InfluxDB 3.11.2 Enterprise (docs-tooling `influxdb3-enterprise`,
 * `:8181`, PachaTree), 2026-09-02, via `POST /api/v3/query_sql` with
 * `format: "json"`. Column names and types match the `information_schema`
 * dump recorded in `.docs/mcp-3.11/verification-questions.md` §3.
 *
 * Two properties of this JSON encoding matter to the drift checks and are
 * preserved here rather than tidied away:
 *
 * 1. **Null columns are omitted, not emitted as `null`.** `pt_shards` rows
 *    below have no `min_key`/`max_key` keys at all. An absent key means null,
 *    never a missing column — a missing column fails earlier, at the SQL layer.
 * 2. **Some numeric columns arrive as strings.** `compaction_lag` is
 *    `Utf8View` holding a duration (`"0s"`), and `pt_compaction_run_sets.size_mb`
 *    is `Utf8View` holding a decimal (`"0.00"`).
 */

/** `SELECT sequence, size_bytes, last_modified, is_latest, window_count, ingest_node_count FROM system.pt_storage_checkpoints WHERE is_latest = true` */
export const CHECKPOINTS_LATEST = [
  {
    sequence: 20,
    size_bytes: 253,
    last_modified: "2026-08-31T18:35:45.789Z",
    is_latest: true,
    window_count: 3,
    ingest_node_count: 1,
  },
];

/** `SELECT node_id, sequence, created_at, wal_first_file_id, wal_last_file_id, window_duration_secs, gen0_file_count, total_rows, total_size_bytes FROM system.pt_storage_snapshots` */
export const STORAGE_SNAPSHOTS = [
  {
    node_id: 0,
    sequence: 7,
    created_at: "2026-08-28T18:35:36.819Z",
    wal_first_file_id: 13,
    wal_last_file_id: 15,
    window_duration_secs: 86400,
    gen0_file_count: 1,
    total_rows: 2,
    total_size_bytes: 342,
  },
];

/** `SELECT window, shard_id, min_key, max_key, is_active FROM system.pt_shards` — note the absent null keys. */
export const SHARDS = [
  { window: "2026-08-18", shard_id: 0, is_active: true },
  { window: "2026-08-27", shard_id: 0, is_active: true },
  { window: "2026-08-28", shard_id: 0, is_active: true },
];

/** `SELECT node_id, compaction_lag, seen_lag, deferred_snapshot_count, last_compacted_snapshot_created_at FROM system.pt_compaction_ingest_nodes` */
export const COMPACTION_INGEST_NODES = [
  {
    node_id: 0,
    compaction_lag: "0s",
    seen_lag: "0s",
    deferred_snapshot_count: 0,
    last_compacted_snapshot_created_at: "2026-08-28T18:35:40.932906090Z",
  },
];

/**
 * The `shards` aspect's aggregated result, as the engine returns it.
 *
 * `pt_shards` carries no size column, so per-shard storage is a left join onto
 * grouped `pt_compaction_files` and `pt_storage_run_set_indexes`. The join is
 * left, not inner: two of these three shards have no compacted file at all and
 * must still appear, at zero.
 *
 * Shard identity is the pair `(window, shard_id)` — `shard_id` alone repeats
 * across windows, as it does here.
 */
export const SHARD_STORAGE = [
  {
    window: "2026-08-18",
    shard_id: 0,
    is_active: true,
    file_count: 1,
    compacted_bytes: 380,
    compacted_rows: 2,
    index_bytes: 1331,
  },
  {
    window: "2026-08-28",
    shard_id: 0,
    is_active: true,
    file_count: 0,
    compacted_bytes: 0,
    compacted_rows: 0,
    index_bytes: 0,
  },
  {
    window: "2026-08-27",
    shard_id: 0,
    is_active: true,
    file_count: 0,
    compacted_bytes: 0,
    compacted_rows: 0,
    index_bytes: 0,
  },
];

/**
 * `overview`'s aggregates. Cluster-wide by design: these are separate `sum()`
 * queries rather than a fold over the `shards` aspect's capped list, so the
 * totals stay whole no matter how many shards a cluster has.
 */
export const SHARD_TOTALS = [{ shard_count: 3, active_count: 3 }];

export const STORAGE_TOTALS = [
  { compacted_bytes: 380, index_bytes: 1331, file_count: 1 },
];

/**
 * Per-node ingest. `pt_ingest_files` and `pt_ingest_wal` carry `node_id` and
 * `node_name` but no `window` or `shard_id` — the 3.11 columns that make a
 * per-node breakdown possible, and the reason these two tables belong to
 * `overview` rather than to `shards`.
 */
export const INGEST_FILES_BY_NODE = [
  {
    node_id: 0,
    node_name: "node0",
    file_count: 6,
    size_bytes: 1798,
    row_count: 10,
  },
];

export const INGEST_WAL_BY_NODE = [
  {
    node_id: 0,
    node_name: "node0",
    wal_file_count: 2,
    wal_bytes: 458,
    wal_rows: 2,
  },
];

/**
 * Every duration shape `compaction_lag` and `seen_lag` can hold.
 *
 * Only `"0s"` was observable on the idle testbench, so the rest come from the
 * producer rather than from a live read: `format_duration_human` in
 * `influxdb_pro@ent/influxdb3/src/commands/serve/enterprise/pacha_tree_compaction_wrapper.rs:82`.
 * It joins `{d}d`, `{h}h`, `{m}m`, `{s}s` with single spaces, **omits any part
 * that is zero**, falls back to `"0s"` when all four are zero, truncates to
 * whole seconds, and clamps negative durations to `"0s"` at the source.
 *
 * The omit-zero rule is the trap: `"4m"` and `"2d 5h"` are as valid as
 * `"1h 2m 3s"`, so a fixed three-group pattern would reject real values.
 */
export const DURATION_STRINGS: ReadonlyArray<readonly [string, number]> = [
  ["0s", 0],
  ["45s", 45],
  ["4m", 240],
  ["4m 30s", 270],
  ["1h 2m 3s", 3723],
  ["2d 5h", 190800],
  ["3d", 259200],
];
