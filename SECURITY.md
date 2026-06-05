# Security Policy

## Security Considerations

This project implements an MCP (Model Context Protocol) server. Please be aware that:

- MCP servers inherently expose system capabilities to connected clients
- The security model depends on trust between the MCP client and server
- This server grants access to InfluxDB and database contents

## Responsible Use

⚠️ **Important**: This software is provided as-is. Users are responsible for:

- Understanding what capabilities this MCP server exposes
- Ensuring they trust the MCP clients connecting to this server
- Implementing appropriate network-level security measures
- Reviewing and understanding the code before deployment

## Reporting Security Issues

InfluxData takes security and our users' trust seriously.
If you discover a security vulnerability specific to our implementation (not inherent MCP limitations),
please responsibly disclose it by contacting security@influxdata.com.
More details about security vulnerability reporting can be found on the InfluxData:
[How to Report Vulnerabilities](https://www.influxdata.com/how-to-report-security-vulnerabilities/) page.

## Best Practices

When deploying this MCP server:

- Only run on the same device as your trusted Agent
- Review the permissions and capabilities exposed
