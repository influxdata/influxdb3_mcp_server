/**
 * Storage Digest Builder
 *
 * Turns `system.pt_*` rows into a computed answer — "compaction is ~4 minutes
 * behind across 12 shards" — rather than dumping system tables into the model's
 * context.
 *
 * Pure: rows in, digest out. Every value it reports is derived here, so this is
 * also where schema drift has to be caught. See `inspect-storage-spec.md`,
 * "Schema drift: fail-closed by design".
 */

export type StorageAspect = "overview" | "shards" | "compaction" | "snapshots";

export type AspectRows = Record<string, any[]>;

export interface LatestCheckpoint {
  sequence: number;
  ageSeconds: number;
  sizeBytes: number;
  windowCount: number | null;
  ingestNodeCount: number | null;
}

export interface CompactionSummary {
  /** Null when no node has compacted a snapshot yet — absence of data, not drift. */
  maxLagSeconds: number | null;
  deferredSnapshotCount: number;
  nodeCount: number;
}

export interface ShardStorage {
  /** Shard identity is the pair, not `shardId` alone — ids repeat across windows. */
  window: string;
  shardId: number;
  isActive: boolean;
  fileCount: number;
  compactedBytes: number;
  indexBytes: number;
  totalBytes: number;
}

/** Set when rows were dropped, so the model is told rather than left guessing. */
export interface Truncation {
  shown: number;
  cap: number;
}

export interface ShardsSummary {
  shardCount: number;
  activeCount: number;
  compactedBytes: number;
  indexBytes: number;
  totalBytes: number;
  /** Biggest first. */
  largest: ShardStorage[];
  /**
   * Null when every shard fit. When set, `largest` and all the counts above
   * describe only the shards shown — they are not cluster-wide totals.
   */
  truncated: Truncation | null;
}

export interface DigestOptions {
  /** Rows of per-shard detail to keep. The query fetches one more, to detect overflow. */
  shardLimit?: number;
}

const DEFAULT_SHARD_LIMIT = 100;

/** Cluster-wide, from `sum()` queries rather than a fold over the capped shard list. */
export interface StorageTotals {
  shardCount: number;
  activeShardCount: number;
  compactedBytes: number;
  indexBytes: number;
  totalBytes: number;
  fileCount: number;
}

export interface IngestNode {
  nodeId: number;
  nodeName: string | null;
  persistedFiles: number;
  persistedBytes: number;
  walFiles: number;
  walBytes: number;
}

export interface StorageDigest {
  aspect: StorageAspect;
  latestCheckpoint?: LatestCheckpoint;
  compaction?: CompactionSummary;
  shards?: ShardsSummary;
  storage?: StorageTotals;
  ingestNodes?: IngestNode[];
}

const MS_PER_SECOND = 1000;

/**
 * Raised when `pt_*` data does not match what an aspect was built against.
 *
 * `message` is model-facing and deliberately says nothing a model could act on
 * wrongly; `detail` names the table, column, and aspect for whoever has to
 * chase the next InfluxDB release.
 */
export class StorageSchemaDriftError extends Error {
  constructor(
    readonly aspect: StorageAspect,
    readonly detail: string,
  ) {
    super(
      `storage introspection data didn't match the expected shape for \`${aspect}\`; ` +
        `this usually means the InfluxDB schema changed (${detail})`,
    );
    this.name = "StorageSchemaDriftError";
  }
}

type ColumnKind = "number" | "timestamp" | "boolean" | "string";

interface ColumnSpec {
  kind: ColumnKind;
  nullable?: boolean;
}

type TableShape = Record<string, ColumnSpec>;

/** `system.pt_storage_checkpoints` as of InfluxDB 3.11.2. */
const CHECKPOINT_SHAPE: TableShape = {
  sequence: { kind: "number" },
  size_bytes: { kind: "number" },
  last_modified: { kind: "timestamp" },
  is_latest: { kind: "boolean" },
  window_count: { kind: "number", nullable: true },
  ingest_node_count: { kind: "number", nullable: true },
};

function matchesKind(value: unknown, kind: ColumnKind): boolean {
  switch (kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "timestamp":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
}

/**
 * Drift layer 2: check every column this aspect reads before interpreting it.
 *
 * A column absent from the row is null — the JSON encoding omits nulls rather
 * than emitting them — so absence is only drift when the column is not
 * nullable. A column missing from the *table* never reaches here; the explicit
 * `SELECT` fails at the SQL layer first (drift layer 1).
 */
function checkShape(
  aspect: StorageAspect,
  table: string,
  row: Record<string, unknown>,
  shape: TableShape,
): void {
  for (const [column, spec] of Object.entries(shape)) {
    const value = row[column] ?? null;
    if (value === null) {
      if (spec.nullable) continue;
      throw new StorageSchemaDriftError(
        aspect,
        `${table}.${column} is missing`,
      );
    }
    if (!matchesKind(value, spec.kind)) {
      throw new StorageSchemaDriftError(
        aspect,
        `${table}.${column} is ${typeof value}, expected ${spec.kind}`,
      );
    }
  }
}

/** `system.pt_compaction_ingest_nodes` as of InfluxDB 3.11.2. */
const COMPACTION_INGEST_NODE_SHAPE: TableShape = {
  node_id: { kind: "number" },
  compaction_lag: { kind: "string", nullable: true },
  seen_lag: { kind: "string", nullable: true },
  deferred_snapshot_count: { kind: "number" },
};

/**
 * The `shards` aspect's aggregated projection — a left join of `pt_shards`
 * onto grouped `pt_compaction_files` and `pt_storage_run_set_indexes`, since
 * `pt_shards` itself carries no size column. Aggregating in SQL rather than
 * here keeps a large cluster from shipping one row per file over the wire.
 */
const SHARD_STORAGE_SHAPE: TableShape = {
  window: { kind: "string" },
  shard_id: { kind: "number" },
  is_active: { kind: "boolean" },
  file_count: { kind: "number" },
  compacted_bytes: { kind: "number" },
  index_bytes: { kind: "number" },
};

const SHARD_TOTALS_SHAPE: TableShape = {
  shard_count: { kind: "number" },
  active_count: { kind: "number" },
};

const STORAGE_TOTALS_SHAPE: TableShape = {
  compacted_bytes: { kind: "number" },
  index_bytes: { kind: "number" },
  file_count: { kind: "number" },
};

const INGEST_FILES_SHAPE: TableShape = {
  node_id: { kind: "number" },
  node_name: { kind: "string", nullable: true },
  file_count: { kind: "number" },
  size_bytes: { kind: "number" },
};

const INGEST_WAL_SHAPE: TableShape = {
  node_id: { kind: "number" },
  node_name: { kind: "string", nullable: true },
  wal_file_count: { kind: "number" },
  wal_bytes: { kind: "number" },
};

const DURATION_UNIT_SECONDS: Record<string, number> = {
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

/** One `{count}{unit}` part; the whole string is these joined by single spaces. */
const DURATION_PART = /^(\d+)([dhms])$/;

/**
 * Parse the duration strings `compaction_lag` and `seen_lag` carry.
 *
 * The grammar is whatever `format_duration_human` emits (influxdb_pro,
 * `pacha_tree_compaction_wrapper.rs`): zero-valued parts are omitted, so
 * `"4m"` and `"2d 5h"` are as valid as `"1h 2m 3s"`. Anything outside it is
 * treated as drift rather than guessed at.
 */
function parseDurationSeconds(
  value: string,
  aspect: StorageAspect,
  source: string,
): number {
  let seconds = 0;
  for (const part of value.split(" ")) {
    const match = DURATION_PART.exec(part);
    if (!match) {
      throw new StorageSchemaDriftError(
        aspect,
        `${source} is not a duration: ${JSON.stringify(value)}`,
      );
    }
    seconds += Number(match[1]) * DURATION_UNIT_SECONDS[match[2]];
  }
  return seconds;
}

/** Drift layer 3: a byte count or a file count cannot be negative. */
function nonNegative(
  aspect: StorageAspect,
  source: string,
  value: number,
): void {
  if (value < 0) {
    throw new StorageSchemaDriftError(
      aspect,
      `${source} is negative: ${value}`,
    );
  }
}

/** Drift layer 3: an age is seconds elapsed, so it can never be negative. */
function ageSeconds(
  timestamp: string,
  now: Date,
  aspect: StorageAspect,
  source: string,
): number {
  const seconds =
    (now.getTime() - new Date(timestamp).getTime()) / MS_PER_SECOND;
  if (!(seconds >= 0)) {
    throw new StorageSchemaDriftError(
      aspect,
      `${source} is ${seconds}s in the future`,
    );
  }
  return seconds;
}

export function buildStorageDigest(
  aspect: StorageAspect,
  rows: AspectRows,
  now: Date,
  options: DigestOptions = {},
): StorageDigest {
  switch (aspect) {
    case "snapshots":
      return {
        aspect,
        latestCheckpoint: latestCheckpoint(aspect, rows, now),
      };
    case "compaction":
      return { aspect, compaction: compactionSummary(aspect, rows) };
    case "shards":
      return { aspect, shards: shardsSummary(aspect, rows, options) };
    case "overview":
      return {
        aspect,
        storage: storageTotals(aspect, rows),
        compaction: compactionSummary(aspect, rows),
        latestCheckpoint: latestCheckpoint(aspect, rows, now),
        ingestNodes: ingestNodes(aspect, rows),
      };
  }
}

function storageTotals(aspect: StorageAspect, rows: AspectRows): StorageTotals {
  const shards = rows.shard_totals[0];
  const storage = rows.storage_totals[0];
  checkShape(aspect, "shard_totals", shards, SHARD_TOTALS_SHAPE);
  checkShape(aspect, "storage_totals", storage, STORAGE_TOTALS_SHAPE);
  nonNegative(aspect, "shard_totals.shard_count", shards.shard_count);
  nonNegative(
    aspect,
    "storage_totals.compacted_bytes",
    storage.compacted_bytes,
  );
  nonNegative(aspect, "storage_totals.index_bytes", storage.index_bytes);

  return {
    shardCount: shards.shard_count,
    activeShardCount: shards.active_count,
    compactedBytes: storage.compacted_bytes,
    indexBytes: storage.index_bytes,
    totalBytes: storage.compacted_bytes + storage.index_bytes,
    fileCount: storage.file_count,
  };
}

/**
 * Fold the two per-node ingest tables into one row per node.
 *
 * They are grouped separately and only meet here, so a node present in one and
 * absent from the other still has to appear — with zeros for the side it is
 * missing from, not dropped.
 */
function ingestNodes(aspect: StorageAspect, rows: AspectRows): IngestNode[] {
  const byNode = new Map<number, IngestNode>();

  const nodeFor = (nodeId: number, nodeName: string | null): IngestNode => {
    const existing = byNode.get(nodeId);
    if (existing) return existing;
    const created: IngestNode = {
      nodeId,
      nodeName,
      persistedFiles: 0,
      persistedBytes: 0,
      walFiles: 0,
      walBytes: 0,
    };
    byNode.set(nodeId, created);
    return created;
  };

  for (const row of rows.ingest_files_by_node) {
    checkShape(aspect, "ingest_files_by_node", row, INGEST_FILES_SHAPE);
    nonNegative(aspect, "ingest_files_by_node.size_bytes", row.size_bytes);
    const node = nodeFor(row.node_id, row.node_name ?? null);
    node.persistedFiles += row.file_count;
    node.persistedBytes += row.size_bytes;
  }

  for (const row of rows.ingest_wal_by_node) {
    checkShape(aspect, "ingest_wal_by_node", row, INGEST_WAL_SHAPE);
    nonNegative(aspect, "ingest_wal_by_node.wal_bytes", row.wal_bytes);
    const node = nodeFor(row.node_id, row.node_name ?? null);
    node.walFiles += row.wal_file_count;
    node.walBytes += row.wal_bytes;
  }

  return [...byNode.values()].sort((a, b) => a.nodeId - b.nodeId);
}

function latestCheckpoint(
  aspect: StorageAspect,
  rows: AspectRows,
  now: Date,
): LatestCheckpoint {
  const checkpoint = rows.pt_storage_checkpoints[0];
  checkShape(aspect, "pt_storage_checkpoints", checkpoint, CHECKPOINT_SHAPE);

  return {
    sequence: checkpoint.sequence,
    ageSeconds: ageSeconds(
      checkpoint.last_modified,
      now,
      aspect,
      "pt_storage_checkpoints.last_modified",
    ),
    sizeBytes: checkpoint.size_bytes,
    windowCount: checkpoint.window_count ?? null,
    ingestNodeCount: checkpoint.ingest_node_count ?? null,
  };
}

function shardsSummary(
  aspect: StorageAspect,
  rows: AspectRows,
  options: DigestOptions,
): ShardsSummary {
  const cap = options.shardLimit ?? DEFAULT_SHARD_LIMIT;
  const overflowed = rows.shard_storage.length > cap;

  const largest: ShardStorage[] = rows.shard_storage
    .slice(0, cap)
    .map((row) => {
      checkShape(aspect, "shard_storage", row, SHARD_STORAGE_SHAPE);
      nonNegative(aspect, "shard_storage.compacted_bytes", row.compacted_bytes);
      nonNegative(aspect, "shard_storage.index_bytes", row.index_bytes);

      return {
        window: row.window,
        shardId: row.shard_id,
        isActive: row.is_active,
        fileCount: row.file_count,
        compactedBytes: row.compacted_bytes,
        indexBytes: row.index_bytes,
        totalBytes: row.compacted_bytes + row.index_bytes,
      };
    });

  return {
    shardCount: largest.length,
    activeCount: largest.filter((shard) => shard.isActive).length,
    compactedBytes: sum(largest, (shard) => shard.compactedBytes),
    indexBytes: sum(largest, (shard) => shard.indexBytes),
    totalBytes: sum(largest, (shard) => shard.totalBytes),
    largest,
    truncated: overflowed ? { shown: largest.length, cap } : null,
  };
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

function compactionSummary(
  aspect: StorageAspect,
  rows: AspectRows,
): CompactionSummary {
  const nodes = rows.pt_compaction_ingest_nodes;
  const lags: number[] = [];
  let deferredSnapshotCount = 0;

  for (const node of nodes) {
    checkShape(
      aspect,
      "pt_compaction_ingest_nodes",
      node,
      COMPACTION_INGEST_NODE_SHAPE,
    );
    deferredSnapshotCount += node.deferred_snapshot_count;

    const lag = node.compaction_lag ?? null;
    if (lag !== null) {
      lags.push(
        parseDurationSeconds(
          lag,
          aspect,
          "pt_compaction_ingest_nodes.compaction_lag",
        ),
      );
    }
  }

  return {
    maxLagSeconds: lags.length > 0 ? Math.max(...lags) : null,
    deferredSnapshotCount,
    nodeCount: nodes.length,
  };
}
