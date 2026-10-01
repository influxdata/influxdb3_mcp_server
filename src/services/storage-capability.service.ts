/**
 * Storage Capability Probe
 *
 * Answers one question: does the instance on the other end run the PachaTree
 * storage engine, so that `system.pt_*` can be queried?
 *
 * The server trusts `INFLUX_DB_PRODUCT_TYPE` verbatim and never parses the
 * version it already fetches from `/ping`. This probe is the first thing that
 * checks the instance instead of the configuration.
 */

export interface StorageCapability {
  pachaTree: boolean;
  version?: string;
}

export interface StorageProbeDeps {
  ping(): Promise<{ ok: boolean; version?: string; message?: string }>;
  executeQuery(
    query: string,
    database: string,
    options?: Record<string, unknown>,
  ): Promise<any>;
}

/** Bounded, cheap, and routed through a database only because the API demands one. */
const PROBE_QUERY = "SELECT 1 FROM system.pt_shards LIMIT 1";

export async function probeStorageCapability(
  deps: StorageProbeDeps,
  database: string,
): Promise<StorageCapability> {
  let version: string | undefined;
  try {
    const pong = await deps.ping();
    if (!pong.ok) return { pachaTree: false };
    version = pong.version;
  } catch {
    return { pachaTree: false };
  }

  try {
    await deps.executeQuery(PROBE_QUERY, database);
  } catch {
    return { pachaTree: false, version };
  }
  return { pachaTree: true, version };
}
