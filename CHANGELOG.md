# Changelog

All notable changes to the official InfluxDB MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-11-05

### Added

- **InfluxDB Cloud Serverless Support**: Complete support for InfluxDB Cloud Serverless instances

  - Full database management with Cloud Serverless specific parameters: `description`, `retentionPeriod`
  - Support for bucket operations (Cloud Serverless databases are called "buckets")
  - Enhanced `create_database` and `update_database` tools with Cloud Serverless configuration
  - Bucket renaming support via `newName` parameter in `update_database`
  - Specialized response parsing for Cloud Serverless `_fields` array format
  - Schema exploration via `information_schema` queries compatible with Cloud Serverless
  - New configuration files: `env.cloud-serverless.example` and `example-cloud-serverless.mcp.json`

- **Custom Context System**: Optional user-provided database context and documentation

  - New `ContextFileService` for flexible context file discovery
  - `context-file` MCP resource exposing custom documentation via `influx://context`
  - `load-context` MCP prompt for one-click context loading
  - `load_database_context` tool for agents to access user-provided context
  - Support for multiple context file formats: JSON, Markdown, and plain text
  - Flexible file placement: `/context/` folder or files with "context" in name

### Enhanced

- **Query Operations**:

  - Universal CAST requirements documentation for both Cloud Dedicated and Cloud Serverless
  - Enhanced query tools with product-specific guidance for aggregation functions
  - Proper handling of Cloud Serverless response format with `_fields` arrays
  - Updated query examples with correct CAST syntax for v3 cloud products

- **Database Management**:

  - Cloud Serverless bucket lifecycle management (create, update, delete, list)
  - Retention period enforcement awareness and error handling
  - Product-specific parameter validation and configuration
  - Enhanced database listing with Cloud Serverless metadata

- **Write Operations**:

  - Retention period violation handling for cloud instances
  - Improved error messages for timestamp-related write failures
  - Enhanced line protocol validation and troubleshooting guidance

- **Help System**:
  - Updated help content with Cloud Serverless specific requirements
  - Added retention period error guidance for cloud instances
  - Enhanced query documentation with CAST requirements for cloud products
  - Context system usage documentation

### Technical Improvements

- Product type detection and response parsing for Cloud Serverless
- Enhanced error handling for retention period violations
- Improved type safety for multi-product database operations
- Context file service with flexible discovery patterns
- Better separation of cloud-specific vs universal query requirements

## [1.1.0] - 2025-06-23

### Added

- **InfluxDB Cloud Dedicated Support**: Complete support for InfluxDB Cloud Dedicated clusters

  - New `update_database` tool for Cloud Dedicated database configuration management
  - Support for Cloud Dedicated specific parameters: `maxTables`, `maxColumnsPerTable`, `retentionPeriod`
  - Enhanced `create_database` tool with optional Cloud Dedicated configuration parameters
  - Dual token support: separate database tokens and management tokens for Cloud Dedicated
  - New cloud token management tools: `cloud_list_database_tokens`, `cloud_get_database_token`, `cloud_create_database_token`, `cloud_update_database_token`, `cloud_delete_database_token`
  - New configuration files: `env.cloud-dedicated.example` and `example-cloud-dedicated.mcp.json`

- **Enhanced Validation System**: Comprehensive operation validation based on product type and configuration

  - All operations now validate required capabilities before execution
  - Product type-specific operation restrictions (e.g., token management only for Core/Enterprise)
  - Configuration validation ensures proper credentials for each operation type
  - Descriptive error messages for invalid operations and missing configuration

- **Improved Documentation**:
  - Updated README with Cloud Dedicated configuration examples
  - New environment variable examples for all supported InfluxDB types
  - Tool availability matrix showing Core/Enterprise vs Cloud Dedicated compatibility
  - Enhanced help content with Cloud Dedicated specific guidance

### Enhanced

- **Database Management**:

  - `create_database` tool now supports Cloud Dedicated configuration parameters
  - `list_databases` returns Cloud Dedicated specific database metadata
  - All database operations now properly validate management capabilities

- **Connection Management**:

  - Improved health checking with flexible endpoint assessment
  - Better connection status reporting for different InfluxDB product types
  - Enhanced error handling for Cloud Dedicated authentication scenarios

- **Configuration Flexibility**:
  - Support for multiple token types (database vs management)
  - Intelligent host selection for data operations vs management operations
  - Proper credential validation for each operation type

### Technical Improvements

- Refactored BaseConnectionService with comprehensive validation methods
- Enhanced HTTP client with better error handling for management API calls
- Improved type safety and error messages throughout the codebase
- Better separation of data plane and control plane operations
- Refactored MCP tools into modular category-based files for improved maintainability and organization

## [1.0.0] - 2025-06-13

### Added

- Initial release of official InfluxDB MCP Server
- Full support for InfluxDB v3 Core and Enterprise
- Complete set of MCP tools for database operations:
  - Database management (create, list, delete)
  - Data querying with SQL support
  - Line protocol data writing
  - Token management (admin and resource tokens)
  - Health checking and diagnostics
- MCP resources for real-time status monitoring:
  - `influx-status`: Comprehensive health and connection status
  - `influx-config`: Current configuration details
- MCP prompts for common operations:
  - `list-databases`: Generate database listing prompts
  - `check-health`: Generate health check prompts
  - `query-recent-data`: Generate recent data query prompts
- Comprehensive help system with detailed guidance
- Support for multiple deployment methods:
  - Local development
  - NPM package
  - Docker container
- Example MCP configuration files for easy setup
- Complete TypeScript implementation with proper error handling
- Modular architecture with specialized services

### Features

- **Query Service**: Simplified response processing for InfluxDB v3 arrays
- **Write Service**: Direct line protocol support with comprehensive examples
- **Token Management**: Full CRUD operations for admin and resource tokens
- **Database Management**: Complete database lifecycle management
- **Help Service**: In-memory help content for optimal LLM performance
- **Health Monitoring**: Real-time status checking with detailed diagnostics

### Technical Details

- Built with @modelcontextprotocol/sdk v1.12.1
- Uses @influxdata/influxdb3-client for InfluxDB connectivity
- TypeScript with strict mode enabled
- ESM module support
- Comprehensive error handling and validation
- Supports stdio transport
