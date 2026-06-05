# Database Context

This MCP server provides tools and resources to remotely access and manage various Influx database instances. Pay attention to tool description after you check the instance type - not every tool is suitable for every type of instance.

## General Guidance for Agents

When working with this InfluxDB instance:

1. **Start with health check** - Always verify connectivity and instance status first
2. **Explore available databases** - List all databases to understand the data landscape
3. **Understand the schema** - Use schema tools to discover measurements and field structures
4. **Query thoughtfully** - Use time filters and appropriate aggregations for performance
5. **Handle errors gracefully** - Pay attention to retention periods and data validation

## User Instructions

Replace this template with your specific database context:

- **Database purpose**: What this InfluxDB instance is used for
- **Data sources**: What systems or applications write data here
- **Key measurements**: Important tables/measurements and their purpose
- **Business context**: Domain-specific information that helps with analysis
- **Query patterns**: Common queries or analysis needs
- **Special considerations**: Retention policies, data sensitivity, etc.

Example contexts could be:

- "IoT sensor data from smart home devices, measurements: temperature, humidity, motion"
- "Application performance metrics for e-commerce platform"
- "Personal fitness tracking data - steps, heart rate, workouts"
- Or simply: "Hi, I'm Jeff, I'm 7 years old and I write my height every day to influx, thanks"

The simpler the better - agents work well with any level of detail you provide!
