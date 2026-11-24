import {
  BaseConnectionService,
  ConnectionInfo,
} from "./base-connection.service.js";
import { QueryService } from "./query.service.js";
import { WriteService } from "./write.service.js";
import { DatabaseManagementService } from "./database-management.service.js";
import { TokenManagementService } from "./token-management.service.js";
import { CloudTokenManagementService } from "./cloud-token-management.service.js";
import { SchemaManagementService } from "./serverless-schema-management.service.js";
import { HelpService } from "./help.service.js";
import { ContextFileService } from "./context-file.service.js";
import { McpServerConfig } from "../config.js";

export class InfluxDBMasterService {
  private baseConnection: BaseConnectionService;
  private queryService: QueryService;
  private writeService: WriteService;
  private databaseService: DatabaseManagementService;
  private tokenService: TokenManagementService;
  private cloudTokenService: CloudTokenManagementService;
  private schemaService: SchemaManagementService;
  private helpService: HelpService;
  private contextFileService: ContextFileService;

  constructor(config: McpServerConfig) {
    this.baseConnection = new BaseConnectionService(config);
    this.queryService = new QueryService(this.baseConnection);
    this.writeService = new WriteService(this.baseConnection);
    this.databaseService = new DatabaseManagementService(this.baseConnection);
    this.tokenService = new TokenManagementService(this.baseConnection);
    this.cloudTokenService = new CloudTokenManagementService(
      this.baseConnection,
    );
    this.schemaService = new SchemaManagementService(this.baseConnection);
    this.helpService = new HelpService();
    this.contextFileService = new ContextFileService();
  }

  getConnectionInfo(): ConnectionInfo {
    return this.baseConnection.getConnectionInfo();
  }

  getConfig(): McpServerConfig {
    return this.baseConnection.getConfig();
  }

  async ping(): Promise<{
    ok: boolean;
    outcome?: "ok" | "unreachable" | "credential_cannot_check";
    version?: string;
    build?: string;
    message?: string;
  }> {
    return this.baseConnection.ping();
  }

  async getHealthStatus(): ReturnType<
    BaseConnectionService["getHealthStatus"]
  > {
    return this.baseConnection.getHealthStatus();
  }

  get query() {
    return this.queryService;
  }

  get write() {
    return this.writeService;
  }

  get database() {
    return this.databaseService;
  }

  get token() {
    return this.tokenService;
  }

  getTokenManagementService() {
    return this.tokenService;
  }

  get cloudToken() {
    return this.cloudTokenService;
  }

  getCloudTokenManagementService() {
    return this.cloudTokenService;
  }

  get schema() {
    return this.schemaService;
  }

  getSchemaManagementService() {
    return this.schemaService;
  }

  get help() {
    return this.helpService;
  }

  get contextFile() {
    return this.contextFileService;
  }

  getContextFileService() {
    return this.contextFileService;
  }

  getClient() {
    return this.baseConnection.getClient();
  }
}
