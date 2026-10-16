import { z } from "zod";
import { InfluxDBMasterService } from "../../services/influxdb-master.service.js";
import { assessHealth } from "../../services/health-assessment.service.js";
import { McpTool } from "../index.js";
import { errorResponse, okResponse } from "../response.js";

export function createHealthTools(service: InfluxDBMasterService): McpTool[] {
  return [
    {
      name: "health_check",
      description:
        "Check health and ping separately. Any successful endpoint confirms health. A credential denied health access does not imply its permitted databases are unavailable. Client initialization alone does not prove connectivity.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      zodSchema: z.object({}),
      handler: async () => {
        try {
          const result = await assessHealth(service);
          return okResponse({
            ok: true,
            timestamp: new Date().toISOString(),
            connection: { ...service.getConnectionInfo(), ...result.overall },
            health: result.health,
            ping: result.ping,
          });
        } catch (error) {
          return errorResponse(error, "health_check_failed");
        }
      },
    },
  ];
}
