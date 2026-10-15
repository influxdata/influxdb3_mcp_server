import type { InfluxDBMasterService } from "./influxdb-master.service.js";

/** SDK initialization is configuration evidence, not a network check. */
export async function assessHealth(service: InfluxDBMasterService) {
  const health = await service.getHealthStatus();
  const ping = await service.ping();
  const healthOutcome =
    health.outcome ?? (health.status === "pass" ? "ok" : "unreachable");
  const pingOutcome = ping.outcome ?? (ping.ok ? "ok" : "unreachable");
  const healthy = healthOutcome === "ok" || pingOutcome === "ok";
  const credentialLimited =
    healthOutcome === "credential_cannot_check" ||
    pingOutcome === "credential_cannot_check";
  return {
    health: { ...health, outcome: healthOutcome },
    ping: { ...ping, outcome: pingOutcome },
    overall: {
      status: healthy ? "healthy" : credentialLimited ? "unknown" : "unhealthy",
      reachable: healthy || credentialLimited,
      message: credentialLimited
        ? "This credential cannot check all health endpoints. Continue using databases it can read."
        : undefined,
    },
  };
}
