/**
 * Digest builder — turns `system.pt_*` rows into a computed answer.
 *
 * Seam: `buildStorageDigest(aspect, rows, now)`. Pure; no network. This is
 * where the three layers of `inspect-storage-spec.md`'s "Schema drift:
 * fail-closed by design" live, so most drift cases are tested here.
 *
 * Rows come from `fixtures/pt-tables.ts`, captured from a live 3.11.2
 * Enterprise instance. Expected values are worked by hand from those rows,
 * never recomputed the way the implementation computes them.
 */

import { describe, it, expect } from "vitest";
import {
  buildStorageDigest,
  StorageSchemaDriftError,
} from "../src/services/storage-digest.service.js";
import {
  CHECKPOINTS_LATEST,
  COMPACTION_INGEST_NODES,
  DURATION_STRINGS,
  INGEST_FILES_BY_NODE,
  INGEST_WAL_BY_NODE,
  SHARD_STORAGE,
  SHARD_TOTALS,
  STORAGE_SNAPSHOTS,
  STORAGE_TOTALS,
} from "./fixtures/pt-tables.js";

/**
 * Exactly 300s after the fixture checkpoint's `last_modified`
 * (2026-08-31T18:35:45.789Z), and 3d 0h 5m 8.97s after the snapshot's
 * `created_at` (2026-08-28T18:35:36.819Z) — 259_508.970s.
 */
const NOW = new Date("2026-08-31T18:40:45.789Z");

describe("buildStorageDigest — snapshots", () => {
  it("reports the latest checkpoint's age and size", () => {
    const digest = buildStorageDigest(
      "snapshots",
      {
        pt_storage_checkpoints: CHECKPOINTS_LATEST,
        pt_storage_snapshots: STORAGE_SNAPSHOTS,
      },
      NOW,
    );

    expect(digest.latestCheckpoint).toEqual({
      sequence: 20,
      ageSeconds: 300,
      sizeBytes: 253,
      windowCount: 3,
      ingestNodeCount: 1,
    });
  });

  // Drift layer 3 — sanity bounds. A checkpoint dated after `now` means
  // `last_modified` no longer means what the digest assumes, so the age is not
  // a number worth reporting.
  it("rejects a checkpoint dated in the future rather than reporting a negative age", () => {
    const build = () =>
      buildStorageDigest(
        "snapshots",
        {
          pt_storage_checkpoints: [
            { ...CHECKPOINTS_LATEST[0], last_modified: "2026-09-01T00:00:00Z" },
          ],
          pt_storage_snapshots: STORAGE_SNAPSHOTS,
        },
        NOW,
      );

    expect(build).toThrow(StorageSchemaDriftError);
    expect(build).toThrow(/pt_storage_checkpoints\.last_modified/);
  });

  // Drift layer 2 — type check. A column that keeps its name but changes type
  // passes an explicit `SELECT` and then produces garbage. `size_bytes` is
  // `UInt64` on 3.11.2; arriving as a string means it no longer means bytes.
  it("rejects a column whose type has changed under the same name", () => {
    const build = () =>
      buildStorageDigest(
        "snapshots",
        {
          pt_storage_checkpoints: [
            { ...CHECKPOINTS_LATEST[0], size_bytes: "253" },
          ],
          pt_storage_snapshots: STORAGE_SNAPSHOTS,
        },
        NOW,
      );

    expect(build).toThrow(StorageSchemaDriftError);
    expect(build).toThrow(/pt_storage_checkpoints\.size_bytes/);
  });

  // Drift layer 2, the other half — an absent key is null, not drift. The JSON
  // encoding omits null columns entirely, so `window_count` missing from a row
  // must read as `null` and not trip the checks above.
  it("treats an omitted nullable column as null rather than as drift", () => {
    const { window_count: _omitted, ...withoutWindowCount } =
      CHECKPOINTS_LATEST[0];

    const digest = buildStorageDigest(
      "snapshots",
      {
        pt_storage_checkpoints: [withoutWindowCount],
        pt_storage_snapshots: STORAGE_SNAPSHOTS,
      },
      NOW,
    );

    expect(digest.latestCheckpoint?.windowCount).toBeNull();
  });
});

describe("buildStorageDigest — compaction", () => {
  function withLag(lag: string) {
    return buildStorageDigest(
      "compaction",
      {
        pt_compaction_ingest_nodes: [
          { ...COMPACTION_INGEST_NODES[0], compaction_lag: lag },
        ],
      },
      NOW,
    );
  }

  it.each(DURATION_STRINGS)(
    "reads compaction lag %j as %i seconds",
    (lag, seconds) => {
      expect(withLag(lag).compaction?.maxLagSeconds).toBe(seconds);
    },
  );

  // Drift layer 2 — `compaction_lag` is `Utf8View` today, so drift here looks
  // like a string that is no longer a duration, not like a type change.
  it("fails closed on a lag string outside the duration grammar", () => {
    expect(() => withLag("about four minutes")).toThrow(
      /pt_compaction_ingest_nodes\.compaction_lag/,
    );
  });

  // The column is nullable: no compacted snapshot yet means no lag to report,
  // which is absence of data, not drift.
  it("reports null lag when the node has not compacted a snapshot yet", () => {
    expect(
      withLag(null as unknown as string).compaction?.maxLagSeconds,
    ).toBeNull();
  });
});

describe("buildStorageDigest — shards", () => {
  it("totals per-shard storage across compacted files and indexes", () => {
    const digest = buildStorageDigest(
      "shards",
      { shard_storage: SHARD_STORAGE },
      NOW,
    );

    // 380 compacted + 1331 index, all of it on the single 2026-08-18 shard.
    expect(digest.shards).toMatchObject({
      shardCount: 3,
      activeCount: 3,
      compactedBytes: 380,
      indexBytes: 1331,
      totalBytes: 1711,
    });
  });

  it("keeps shards that have no compacted files, at zero", () => {
    const digest = buildStorageDigest(
      "shards",
      { shard_storage: SHARD_STORAGE },
      NOW,
    );

    const empty = digest.shards?.largest.filter((s) => s.totalBytes === 0);
    expect(empty).toHaveLength(2);
    expect(digest.shards?.largest[0]).toEqual({
      window: "2026-08-18",
      shardId: 0,
      isActive: true,
      fileCount: 1,
      compactedBytes: 380,
      indexBytes: 1331,
      totalBytes: 1711,
    });
  });
});

describe("buildStorageDigest — shards, bounds and caps", () => {
  // Drift layer 3 — a byte count cannot be negative. `compacted_bytes` is a
  // `sum()` over `UInt64`, so a negative means the column stopped meaning bytes.
  it("rejects a negative byte count rather than reporting it", () => {
    const build = () =>
      buildStorageDigest(
        "shards",
        {
          shard_storage: [{ ...SHARD_STORAGE[0], compacted_bytes: -380 }],
        },
        NOW,
      );

    expect(build).toThrow(StorageSchemaDriftError);
    expect(build).toThrow(/shard_storage\.compacted_bytes/);
  });

  // Bounded output: a large cluster must not exhaust the model's context. The
  // query asks for one row beyond the cap so the extra row is the truncation
  // signal; the digest trims to the cap and says that it did.
  it("trims to the cap and reports the truncation", () => {
    const overCap = Array.from({ length: 5 }, (_, i) => ({
      ...SHARD_STORAGE[0],
      window: `2026-08-${10 + i}`,
      compacted_bytes: 100 * (5 - i),
    }));

    const digest = buildStorageDigest(
      "shards",
      { shard_storage: overCap },
      NOW,
      { shardLimit: 3 },
    );

    expect(digest.shards?.largest).toHaveLength(3);
    expect(digest.shards?.truncated).toEqual({ shown: 3, cap: 3 });
  });

  it("reports no truncation when the rows fit under the cap", () => {
    const digest = buildStorageDigest(
      "shards",
      { shard_storage: SHARD_STORAGE },
      NOW,
      { shardLimit: 100 },
    );

    expect(digest.shards?.truncated).toBeNull();
  });
});

describe("buildStorageDigest — overview", () => {
  const OVERVIEW_ROWS = {
    shard_totals: SHARD_TOTALS,
    storage_totals: STORAGE_TOTALS,
    pt_compaction_ingest_nodes: COMPACTION_INGEST_NODES,
    pt_storage_checkpoints: CHECKPOINTS_LATEST,
    ingest_files_by_node: INGEST_FILES_BY_NODE,
    ingest_wal_by_node: INGEST_WAL_BY_NODE,
  };

  // The impact map's example question, in one call: "how much storage is each
  // shard using, and is compaction keeping up?"
  it("answers shard storage and compaction state without a follow-up call", () => {
    const digest = buildStorageDigest("overview", OVERVIEW_ROWS, NOW);

    expect(digest.storage).toEqual({
      shardCount: 3,
      activeShardCount: 3,
      compactedBytes: 380,
      indexBytes: 1331,
      totalBytes: 1711,
      fileCount: 1,
    });
    expect(digest.compaction).toEqual({
      maxLagSeconds: 0,
      deferredSnapshotCount: 0,
      nodeCount: 1,
    });
    expect(digest.latestCheckpoint?.ageSeconds).toBe(300);
  });

  // `node_name` is what 3.11 added; without it a per-node breakdown reads as a
  // list of opaque integers.
  it("breaks ingest down per node, splitting persisted files from WAL", () => {
    const digest = buildStorageDigest("overview", OVERVIEW_ROWS, NOW);

    expect(digest.ingestNodes).toEqual([
      {
        nodeId: 0,
        nodeName: "node0",
        persistedFiles: 6,
        persistedBytes: 1798,
        walFiles: 2,
        walBytes: 458,
      },
    ]);
  });

  // A node with files but no WAL rows, or the reverse, must still appear —
  // the two tables are grouped separately and only meet here.
  it("includes a node that appears in only one of the two ingest tables", () => {
    const digest = buildStorageDigest(
      "overview",
      {
        ...OVERVIEW_ROWS,
        ingest_wal_by_node: [
          {
            node_id: 1,
            node_name: "node1",
            wal_file_count: 3,
            wal_bytes: 600,
            wal_rows: 4,
          },
        ],
      },
      NOW,
    );

    expect(digest.ingestNodes).toHaveLength(2);
    expect(digest.ingestNodes?.[1]).toEqual({
      nodeId: 1,
      nodeName: "node1",
      persistedFiles: 0,
      persistedBytes: 0,
      walFiles: 3,
      walBytes: 600,
    });
  });
});
