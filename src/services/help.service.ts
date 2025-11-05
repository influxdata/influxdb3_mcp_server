/**
 * InfluxDB Help Service
 *
 * Provides help content for InfluxDB operations. Simple in-memory text content
 * that LLMs can easily navigate and extract relevant information from.
 */

export class HelpService {
  /**
   * Get InfluxDB help content
   */
  getHelp(): string {
    return INFLUXDB_HELP_CONTENT;
  }
}

const INFLUXDB_HELP_CONTENT = `
INFLUXDB MCP SERVER HELP

=== LINE PROTOCOL WRITING ===

Line Protocol Format:
measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp

Examples:
- temperature,location=office value=23.5 1640995200000000000
- sensor_data,device=sensor1,location=room1 temperature=22.5,humidity=45.2,status="ok"
- cpu_usage,host=server1,region=us-east cpu_percent=85.2,memory_percent=67.1 1640995200000000000

Rules:
- Tags are indexed metadata (strings only), fields contain actual data
- Tag values cannot contain spaces, use quotes for field string values
- Timestamp is optional (nanoseconds since Unix epoch)
- Escape special characters in tag values: spaces, commas, equals signs
- Multiple measurements can be written in one call (separate by newlines)

Common Errors:
- Missing field (at least one field required)
- Invalid timestamp format
- Unescaped special characters in tag values
- Retention period violations (Cloud instances): Writing data outside retention window

=== QUERYING DATA ===

SQL Syntax for InfluxDB v3:
SELECT field1, field2 FROM measurement WHERE time >= 'timestamp' AND tag1 = 'value'

Time Filtering:
- WHERE time >= '2024-01-01T00:00:00Z'
- WHERE time >= now() - interval '1 hour'
- WHERE time BETWEEN '2024-01-01' AND '2024-01-02'

Common Queries:
- List measurements: SELECT DISTINCT table_name FROM information_schema.measurements
- Get schema: DESCRIBE measurement_name
- Recent data: SELECT * FROM measurement ORDER BY time DESC LIMIT 10
- Aggregates: SELECT AVG(field1), MAX(field2) FROM measurement WHERE time >= now() - interval '1 day'

Cloud Dedicated & Cloud Serverless Additional Requirements:
- CAST aggregations: Use CAST(COUNT(*) AS DOUBLE), CAST(AVG(field) AS DOUBLE), etc.
- GROUP BY compliance: Include all grouped columns in SELECT clause
- Information schema: Use SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'iox'
- Schema queries: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'measurement' AND table_schema = 'iox'
- Required for: COUNT, SUM, AVG, MIN, MAX aggregation functions
- Without CAST: Aggregations may return empty results or be missing from response

Cloud Examples with CAST:
- Count records: SELECT building, CAST(COUNT(*) AS DOUBLE) AS count FROM sensors GROUP BY building
- Averages: SELECT region, CAST(AVG(cpu_usage) AS DOUBLE) AS avg_cpu FROM metrics GROUP BY region
- Mixed aggregations: SELECT service, CAST(SUM(requests) AS DOUBLE) AS total_requests, CAST(AVG(response_time) AS DOUBLE) AS avg_response FROM app_metrics GROUP BY service

Performance Tips:
- Always include time filters for better performance
- Use specific field names instead of SELECT *
- Index on tags for filtering, not fields
- Use LIMIT for large datasets to avoid memory issues
- Test with COUNT(*) first to check data size before complex queries

=== TOKEN MANAGEMENT ===

Token Types:
1. Operator Token: Super admin with full system access (only one per instance)
2. Named Admin Tokens: Administrative access, can manage resource tokens but not other admin tokens
3. Resource Tokens: Limited to specific databases with read/write permissions

Available Operations:
- Create named admin tokens: create_admin_token tool
- Create resource tokens: create_resource_token tool  
- List admin tokens: list_admin_tokens tool (filter by name)
- List resource tokens: list_resource_tokens tool (filter by name, database, order by various fields)
- Delete any token: delete_token tool (provide exact token name)
- Regenerate operator token: regenerate_operator_token tool (⚠️ DANGEROUS - see admin tokens section)

Security Best Practices:
- Use resource tokens for applications (principle of least privilege)
- Named admin tokens for administrative tasks including resource token management
- Operator token only for critical system operations and admin token management
- Set expiration times when possible (resource tokens support expiry_secs)
- Rotate tokens regularly
- Store tokens securely (environment variables, not in code)

Token Permissions Format:
- Operator: "*:*:*" (all permissions including admin token management)
- Named Admin: "*:*:*" (all permissions except managing other admin tokens)
- Resource: "database1:read,write" or "database1:read" etc.

=== ADMIN TOKENS ===

Admin Token Types:
1. Operator Token: Super admin with full permissions including admin token management
2. Named Admin Tokens: Administrative permissions, can manage resource tokens but not other admin tokens

Named Admin Token Operations:
- Create: Use create_admin_token tool (optionally provide name)
- List: Use list_admin_tokens tool (can filter by token name - partial match)
- Delete: Use delete_token tool (provide exact token name)

Operator Token Operations:
- Regenerate: Use regenerate_operator_token tool (⚠️ USE WITH EXTREME CAUTION)

Key Differences:
- Operator token: Can create/delete/manage ALL tokens (admin and resource tokens)
- Named admin tokens: Full database and system access, can manage resource tokens but cannot manage other admin tokens
- Both have "*:*:*" permissions but operator has additional admin token management capabilities

Use Cases for Named Admin Tokens:
- Database management
- User administration
- Resource token management (create, list, delete resource tokens)
- System configuration
- Backup operations
- Dedicated token management role (create a named admin specifically for managing resource tokens)

⚠️ OPERATOR TOKEN REGENERATION WARNING:
The regenerate_operator_token tool will:
- Invalidate the current operator token immediately
- Generate a new operator token  
- Require updating INFLUX_TOKEN environment variable
- Require restarting the MCP server
- Cannot be undone (irreversible operation)
Use only when absolutely necessary and ensure you can update the environment!

=== RESOURCE TOKENS ===

Resource Token Operations:
- Create: Use create_resource_token tool with specific databases and actions
- List: Use list_resource_tokens tool with filtering options:
  * Filter by database name (partial match)
  * Filter by token name (partial match)  
  * Order by: created_at, token_id, or name
  * Order direction: ASC or DESC (default ASC)
- Delete: Use delete_token tool (provide exact token name)

Scope to specific databases with limited permissions.

Permission Examples:
- Read-only: databases=["mydb"], actions=["read"]
- Write-only: databases=["mydb"], actions=["write"]  
- Full access: databases=["mydb"], actions=["read", "write"]
- Multi-database: databases=["db1", "db2"], actions=["read", "write"]

Best Practices:
- Use separate tokens for different applications
- Grant minimal required permissions
- Set expiration times for temporary access (expiry_secs parameter)
- Use descriptive names for token identification

=== DATABASE MANAGEMENT ===

Database Operations:
- Create: Use create_database tool (provide database name, optional configuration parameters)
- Update: Use update_database tool (Cloud Dedicated and Cloud Serverless only - see parameters below)
- List: Use list_databases tool (no parameters - shows all databases)
- Delete: Use delete_database tool (provide exact database name - PERMANENT, no recovery)

Cloud Dedicated Parameters (create_database and update_database):
- maxTables: Maximum number of tables (default: 500)
- maxColumnsPerTable: Maximum columns per table (default: 200)
- retentionPeriod: Retention period in nanoseconds (default: 0 = no expiration)

Cloud Serverless Parameters (create_database and update_database):
- description: Bucket description for documentation
- retentionPeriod: Retention period in nanoseconds (default: 30 days)
- newName: New bucket name (update_database only - for renaming buckets)

Naming Rules:
- Alphanumeric characters, dashes (-), underscores (_), forward slashes (/)
- Must start with letter or number
- Maximum 64 characters
- Case sensitive

Database Structure:
- Contains measurements (tables)
- Each measurement has tags (indexed) and fields (data)
- Schema evolves dynamically with data (all InfluxDB versions)

Best Practices:
- Use descriptive database names
- Separate different data types into different databases
- Consider retention policies for large datasets
- Regular backups before deletion operations

Note: The list_databases tool returns all available databases with their details.
No filtering or querying parameters are supported - it shows the complete list.

=== TROUBLESHOOTING ===

Connection Issues:
1. Use health_check tool for comprehensive instance status (flexible assessment based on available endpoints)
2. Verify INFLUX_URL environment variable
3. Confirm INFLUX_TOKEN has proper permissions
4. Test network connectivity to InfluxDB server

Health Check Notes:
- Different InfluxDB product types support different endpoints
- Cloud Dedicated does not have /health endpoint available
- Different tokens may have not access to certain endpoints
- If ANY check passes (connection, /health, /ping), instance is considered operational

Authentication Errors:
- Token expired or invalid
- Insufficient permissions for operation
- Token not properly configured for target database

Query Errors:
- Invalid SQL syntax (InfluxDB uses SQL, not InfluxQL)
- Missing time filters causing performance issues
- Incorrect measurement or field names
- Wrong database specified

Write Errors:
- Invalid line protocol format
- Missing required fields
- Tag value formatting issues
- Database doesn't exist
- Retention period violations (Cloud instances): Data timestamp outside allowed retention window

Performance Issues:
- Add time range filters to queries
- Use appropriate aggregation functions
- Index usage (tags vs fields)
- Consider data retention policies
`;
