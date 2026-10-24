import type { QueryService, SchemaInfo } from "./query.service.js";
import {
  OperationError,
  operationErrorDetails,
} from "./error-resolution.service.js";

export function tableMetadata(
  name: string,
  evidence?: Pick<SchemaInfo, "schema_mode" | "deletion">,
) {
  return {
    schema_mode: evidence?.schema_mode ?? {
      value: "unknown",
      source: "unknown",
    },
    deletion: evidence?.deletion ?? { value: "unknown", source: "unknown" },
    warnings:
      evidence?.deletion?.source !== "server" &&
      /.+-(?:\d{10,20}|\d{8}T\d{6})$/u.test(name)
        ? [
            {
              code: "possibly_deleted",
              message: `Table '${name}' resembles a deletion tombstone. Its deletion status is unknown; the table remains listed.`,
            },
          ]
        : [],
  };
}

export function schemaMetadata(schema: SchemaInfo, name: string) {
  return {
    ...schema,
    columns: schema.columns.map((column) => ({
      ...column,
      source:
        column.category === "unknown"
          ? "unknown"
          : (column.source ??
            (column.category === "time" ? "inferred" : "server")),
    })),
    ...tableMetadata(name, schema),
    warnings: [
      ...tableMetadata(name, schema).warnings,
      ...(schema.warnings ?? []),
      ...schema.columns
        .filter((column) => column.category === "unknown")
        .map((column) => ({
          code: "unknown_column_category",
          message: `Table '${name}' column '${column.name}' has unknown tag/field category.`,
        })),
    ],
  };
}

interface InvestigationOptions {
  db: string;
  includeSamples: boolean;
  includeCardinality: boolean;
  maxTables: number;
  sampleRowsPerTable: number;
  sampleWindowHours: number;
}

export async function investigateDatabase(
  query: QueryService,
  args: InvestigationOptions,
) {
  if (args.includeCardinality)
    throw new OperationError(
      "Cardinality estimation has no agreed cost budget.",
      "unsupported_option",
    );
  const allTables = (await query.getMeasurements(args.db)).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const tables = allTables.slice(0, args.maxTables);
  const end = new Date();
  const start = new Date(end.getTime() - args.sampleWindowHours * 3600000);
  const sampleWindow = {
    hours: args.sampleWindowHours,
    start: start.toISOString(),
    end: end.toISOString(),
  };
  // Reserve the worst case across products: three schema calls, a sample, and
  // one optional query-history lookup. No cardinality or extra probes run.
  const budget = {
    max: 1 + args.maxTables * (args.includeSamples ? 5 : 3),
    used: 1,
    accounting: "upper_bound_requests",
  };
  const tableDetails = [];
  for (const table of tables) {
    let schema: ReturnType<typeof schemaMetadata> | undefined;
    try {
      budget.used += 3;
      schema = schemaMetadata(
        await query.getMeasurementSchema(table.name, args.db),
        table.name,
      );
      if (!schema.columns.length)
        throw new OperationError(
          "Metadata returned no columns; absence and denied metadata cannot be distinguished.",
          "metadata_unavailable",
        );
    } catch (error) {
      tableDetails.push({
        name: table.name,
        status: "failed",
        ...tableMetadata(table.name, schema),
        error: operationErrorDetails(error, "metadata_unavailable"),
      });
      continue;
    }
    if (!args.includeSamples) {
      tableDetails.push({
        name: table.name,
        status: "ok",
        schema,
        ...tableMetadata(table.name, schema),
        warnings: schema.warnings,
      });
      continue;
    }
    try {
      budget.used += 2;
      const identifier = table.name.replace(/"/gu, '""');
      const sample = await query.querySqlReadOnly(
        `SELECT * FROM "${identifier}" WHERE time >= '${sampleWindow.start}' AND time <= '${sampleWindow.end}' ORDER BY time DESC`,
        args.db,
        { maxRows: args.sampleRowsPerTable },
      );
      tableDetails.push({
        name: table.name,
        status: "ok",
        schema,
        ...tableMetadata(table.name, schema),
        samples: sample.rows,
        sample_metadata: sample.metadata,
        sample_outcome: sample.rows.length ? "data" : "no_rows_in_window",
        warnings: [...schema.warnings, ...sample.warnings],
      });
    } catch (error) {
      tableDetails.push({
        name: table.name,
        status: "partial",
        schema,
        ...tableMetadata(table.name, schema),
        warnings: schema.warnings,
        error: operationErrorDetails(error, "query_failed"),
      });
    }
  }
  return {
    ok: true,
    db: args.db,
    access_outcome: allTables.length ? "data" : "empty",
    table_total: allTables.length,
    table_total_scope: "visible_to_credential",
    table_count: tableDetails.length,
    tables_truncated: tables.length < allTables.length,
    tables_failed: tableDetails.filter((table) => table.status === "failed")
      .length,
    tables_partial: tableDetails.filter((table) => table.status === "partial")
      .length,
    tables: tableDetails,
    sample_window: args.includeSamples ? sampleWindow : null,
    query_budget: {
      ...budget,
      stopped_reason:
        tables.length < allTables.length ? "max_tables" : "complete",
      stopped_after_table: tableDetails.at(-1)?.name ?? null,
    },
    warnings: tableDetails.flatMap((table) => table.warnings),
    failures: tableDetails
      .filter((table) => "error" in table)
      .map((table) => ({ name: table.name, error: table.error })),
  };
}
