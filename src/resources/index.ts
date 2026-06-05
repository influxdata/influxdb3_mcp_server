/**
 * MCP Resources Definitions
 *
 * Defines resources that provide read-only data access
 */

import { InfluxDBMasterService } from "../services/influxdb-master.service.js";

export interface McpResource {
  name: string;
  uri: string;
  description: string;
  handler: () => Promise<{
    contents: Array<{ uri: string; text: string; mimeType?: string }>;
  }>;
}

/**
 * Create all MCP resources for InfluxDB data access
 */
export function createResources(
  influxService: InfluxDBMasterService,
): McpResource[] {
  return [
    {
      name: "influx-config",
      uri: "influx://config",
      description: "InfluxDB configuration and connection status",
      handler: async () => {
        const connectionInfo = influxService.getConnectionInfo();
        const pingResult = await influxService.ping();
        const isConnected = pingResult.ok;

        const config = {
          connection: {
            url: connectionInfo.url,
            hasToken: connectionInfo.hasToken,
            database: connectionInfo.database,
            isConnected,
          },
        };

        return {
          contents: [
            {
              uri: "influx://config",
              text: JSON.stringify(config, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      },
    },

    {
      name: "influx-status",
      uri: "influx://status",
      description:
        "Comprehensive status of the InfluxDB connection including ping and health check results",
      handler: async () => {
        try {
          const pingResult = await influxService.ping();

          let healthStatus;
          try {
            healthStatus = await influxService.getHealthStatus();
          } catch (healthError: any) {
            healthStatus = {
              status: "unavailable",
              error: healthError.message,
            };
          }

          const status = {
            timestamp: new Date().toISOString(),
            ping: {
              ok: pingResult.ok,
              version: pingResult.version || null,
              build: pingResult.build || null,
              message: pingResult.message || null,
            },
            health: healthStatus,
            overall: {
              status:
                pingResult.ok && healthStatus.status !== "fail"
                  ? "healthy"
                  : "unhealthy",
              connection: pingResult.ok ? "connected" : "disconnected",
            },
          };

          return {
            contents: [
              {
                uri: "influx://status",
                text: JSON.stringify(status, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        } catch (error: any) {
          const errorStatus = {
            timestamp: new Date().toISOString(),
            ping: {
              ok: false,
              error: error.message,
            },
            health: {
              status: "unavailable",
              error: "Could not perform health check",
            },
            overall: {
              status: "error",
              connection: "failed",
            },
            error: error.message,
          };

          return {
            contents: [
              {
                uri: "influx://status",
                text: JSON.stringify(errorStatus, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }
      },
    },

    {
      name: "influx-databases",
      uri: "influx://databases",
      description: "List of all databases in the InfluxDB instance",
      handler: async () => {
        try {
          const databases = await influxService.database.listDatabases();

          const databaseList = {
            timestamp: new Date().toISOString(),
            databases: databases,
            count: databases.length,
            status: "success",
          };

          return {
            contents: [
              {
                uri: "influx://databases",
                text: JSON.stringify(databaseList, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        } catch (error: any) {
          const errorInfo = {
            timestamp: new Date().toISOString(),
            databases: [],
            count: 0,
            status: "error",
            error: error.message,
            connectionInfo: influxService.getConnectionInfo(),
          };

          return {
            contents: [
              {
                uri: "influx://databases",
                text: JSON.stringify(errorInfo, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }
      },
    },

    {
      name: "context-file",
      uri: "influx://context",
      description:
        "Custom context file with user-defined database descriptions or documentation",
      handler: async () => {
        try {
          const contextFile = await influxService.contextFile.loadContextFile();

          if (!contextFile) {
            return {
              contents: [
                {
                  uri: "influx://context",
                  text: JSON.stringify(
                    {
                      timestamp: new Date().toISOString(),
                      status: "not_found",
                      message:
                        "No context file found. Create a file in /context/ folder or name a file with 'context' in the name (.json, .txt, .md)",
                      searchPaths: [
                        "./context/ (any .json, .txt, .md file)",
                        "./ (files with 'context' in name)",
                      ],
                    },
                    null,
                    2,
                  ),
                  mimeType: "application/json",
                },
              ],
            };
          }

          let mimeType = "text/plain";
          switch (contextFile.extension) {
            case "json":
              mimeType = "application/json";
              break;
            case "md":
              mimeType = "text/markdown";
              break;
            case "txt":
            default:
              mimeType = "text/plain";
              break;
          }

          return {
            contents: [
              {
                uri: "influx://context",
                text: contextFile.content,
                mimeType: mimeType,
              },
            ],
          };
        } catch (error: any) {
          const errorInfo = {
            timestamp: new Date().toISOString(),
            status: "error",
            error: error.message,
            message: "Failed to load context file",
          };

          return {
            contents: [
              {
                uri: "influx://context",
                text: JSON.stringify(errorInfo, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }
      },
    },
  ];
}
