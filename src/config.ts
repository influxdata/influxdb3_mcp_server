import dotenv from "dotenv";
import { InfluxProductType } from "./helpers/enums/influx-product-types.enum.js";

dotenv.config();

const CLUSTERED_PLACEHOLDER_ID_FOR_CLOUD_DEDICATED_HANDLERS =
  "11111111-1111-1111-1111-111111111111";

export interface InfluxConfig {
  url?: string;
  token?: string;
  management_token?: string;
  type: string;
  account_id?: string;
  cluster_id?: string;
}

export const TOOL_PROFILES = ["readonly", "readwrite", "operator"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];

export interface McpServerConfig {
  influx: InfluxConfig;
  server: {
    name: string;
    version: string;
  };
  tools: {
    profile: ToolProfile;
  };
}

export function loadConfig(): McpServerConfig {
  return {
    influx: {
      url: process.env.INFLUX_DB_INSTANCE_URL,
      token:
        process.env.INFLUX_DB_TOKEN ||
        process.env.INFLUX_DB_DATABASE_TOKEN ||
        undefined,
      management_token: process.env.INFLUX_DB_MANAGEMENT_TOKEN || undefined,
      type:
        (process.env.INFLUX_DB_PRODUCT_TYPE as InfluxProductType) || "unknown",
      account_id: process.env.INFLUX_DB_ACCOUNT_ID,
      cluster_id: process.env.INFLUX_DB_CLUSTER_ID,
    },
    server: {
      name: "influxdb-mcp-server",
      version: "2.0.1",
    },
    tools: {
      profile: (process.env.INFLUX_MCP_TOOL_PROFILE ||
        "operator") as ToolProfile,
    },
  };
}

export function validateConfig(config: McpServerConfig): void {
  const errors: string[] = [];

  if (
    !config.influx.type ||
    ![
      InfluxProductType.Enterprise,
      InfluxProductType.Core,
      InfluxProductType.CloudDedicated,
      InfluxProductType.CloudServerless,
      InfluxProductType.Clustered,
    ].includes(config.influx.type as InfluxProductType)
  ) {
    errors.push(
      `INFLUX_DB_PRODUCT_TYPE is required and must be one of: ${InfluxProductType.Enterprise}, ${InfluxProductType.Core}, ${InfluxProductType.CloudDedicated}, ${InfluxProductType.CloudServerless}, ${InfluxProductType.Clustered}`,
    );
  }

  if (config.influx.type === InfluxProductType.CloudDedicated) {
    if (!config.influx.cluster_id) {
      errors.push("INFLUX_DB_CLUSTER_ID is required for cloud-dedicated");
    }
    const hasQueryWrite = config.influx.cluster_id && config.influx.token;
    const hasManagement =
      config.influx.cluster_id &&
      config.influx.account_id &&
      config.influx.management_token;
    if (!hasQueryWrite && !hasManagement) {
      errors.push(
        "For cloud-dedicated, provide at least either: (CLUSTER_ID + DB TOKEN) for query/write, or (CLUSTER_ID + ACCOUNT_ID + MANAGEMENT TOKEN) for management API.",
      );
    }
  } else if (config.influx.type === InfluxProductType.Clustered) {
    const hasQueryWrite = config.influx.token;
    const hasManagement = config.influx.management_token;
    config.influx.account_id =
      CLUSTERED_PLACEHOLDER_ID_FOR_CLOUD_DEDICATED_HANDLERS;
    config.influx.cluster_id =
      CLUSTERED_PLACEHOLDER_ID_FOR_CLOUD_DEDICATED_HANDLERS;
    if (!hasQueryWrite && !hasManagement) {
      errors.push(
        "For clustered, provide at least either: DB TOKEN for query/write, or MANAGEMENT TOKEN for management API.",
      );
    }
  } else if (config.influx.type === InfluxProductType.CloudServerless) {
    if (!config.influx.url) {
      errors.push("INFLUX_DB_INSTANCE_URL is required for cloud-serverless");
    }
    if (!config.influx.token) {
      errors.push("INFLUX_DB_TOKEN is required for cloud-serverless");
    }
  } else if (
    [InfluxProductType.Enterprise, InfluxProductType.Core].includes(
      config.influx.type as InfluxProductType,
    )
  ) {
    if (!config.influx.url) {
      errors.push("INFLUX_DB_INSTANCE_URL is required for core/enterprise");
    }
    if (!config.influx.token) {
      errors.push("INFLUX_DB_TOKEN is required for core/enterprise");
    }
  }

  if (!TOOL_PROFILES.includes(config.tools.profile)) {
    errors.push(
      `INFLUX_MCP_TOOL_PROFILE must be one of: ${TOOL_PROFILES.join(", ")} (got "${config.tools.profile}")`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }
}
