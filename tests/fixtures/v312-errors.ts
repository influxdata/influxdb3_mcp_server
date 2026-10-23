/**
 * InfluxDB 3.12 write/query error fixtures.
 *
 * RECORDED: bodies observed live on 2026-09-30 against the 3.12.0-0.rc.2
 * testbench (Core revision 5cb9011c01, Enterprise revision 25bd899). Replay:
 * docs-tooling `research/claims/2026-09-30-influxdb3-3.12-rc2-mcp-write-query-auth/scripts/probe.sh`.
 *
 * SOURCE: body text read from `influxdb_pro` at tag v3.12.0-0.rc.2, not
 * reproduced live (the testbench runs without a small WAL buffer, a tight
 * query memory pool, or a Parquet-engine ingest-only node).
 */

import type { AxiosErrorShape } from "./error-responses.js";

const DB = "mcp_e2e_312_explicit";

/** RECORDED: explicit-schema DB, undeclared table, accept_partial=true (default). */
export const ENT_400_EXPLICIT_UNDECLARED_TABLE: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "partial write of line protocol occurred",
      data: [
        {
          error_message: `table 'nope' is not defined in database '${DB}', which uses explicit schemas; create the table with the /api/v3/configure/table API before writing to it`,
          line_number: 1,
          original_line: "nope,host=a usage=1.",
        },
      ],
    },
  },
  message: "Request failed with status code 400",
};

/**
 * RECORDED: two-line batch, line 2 has an undeclared field, accept_partial=true.
 * Line 1 was stored (count query returned 1).
 */
export const ENT_400_EXPLICIT_UNDECLARED_FIELD_PARTIAL: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "partial write of line protocol occurred",
      data: [
        {
          error_message: `column 'bogus' (iox::column_type::field::float) is not defined in table 't' of database '${DB}', which uses explicit schemas; add the column with the /api/v3/configure/table API before writing to it`,
          line_number: 2,
          original_line: "t,host=b1,region=w b",
        },
      ],
    },
  },
  message: "Request failed with status code 400",
};

/** RECORDED: same batch with accept_partial=false. Nothing was stored. */
export const ENT_400_EXPLICIT_UNDECLARED_FIELD_NO_PARTIAL: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "line protocol parsing error",
      data: {
        error_message: `column 'bogus' (iox::column_type::field::float) is not defined in table 't' of database '${DB}', which uses explicit schemas; add the column with the /api/v3/configure/table API before writing to it`,
        line_number: 2,
        original_line: "t,host=b bogus=1.0",
      },
    },
  },
  message: "Request failed with status code 400",
};

/** SOURCE: ent/influxdb3_server/src/http.rs (WAL BufferFull -> 429, plain text). */
export const WRITE_429_WAL_BUFFER_FULL: AxiosErrorShape = {
  response: {
    status: 429,
    statusText: "Too Many Requests",
    data: "wal buffer is full; writes are temporarily rejected, retry shortly",
  },
  message: "Request failed with status code 429",
};

/** RECORDED: write with a `db:<name>:read` token on Enterprise. Empty body. */
export const ENT_403_READ_TOKEN_WRITE: AxiosErrorShape = {
  response: { status: 403, statusText: "Forbidden", data: "" },
  message: "Request failed with status code 403",
};

/** RECORDED: query of a database the read-only token wasn't granted. Empty body. */
export const ENT_403_READ_TOKEN_OTHER_DB: AxiosErrorShape = {
  response: { status: 403, statusText: "Forbidden", data: "" },
  message: "Request failed with status code 403",
};

/**
 * SOURCE: DataFusion ResourcesExhausted. At v3.12.0-0.rc.2 the HTTP query
 * handler maps it to 500 (ent http.rs `datafusion_error_status_code`), while
 * the internal release notes describe HTTP 429. Both shapes are covered.
 */
export const QUERY_500_RESOURCES_EXHAUSTED: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: "Resources exhausted: Additional allocation failed for ExternalSorter[0] with top memory consumers (across reservations) as: ExternalSorter[0]#1(can spill: true) consumed 10.0 MB",
  },
  message: "Request failed with status code 500",
};

export const QUERY_429_TOO_MANY_REQUESTS: AxiosErrorShape = {
  response: {
    status: 429,
    statusText: "Too Many Requests",
    data: "this service is overloaded, please try again later",
  },
  message: "Request failed with status code 429",
};

/**
 * SOURCE: ent/influxdb3_write/src/lib.rs NO_QUERY_MODE, raised as a DataFusion
 * NotImplemented error, which the HTTP handler maps to 405.
 */
export const QUERY_405_NO_QUERY_MODE: AxiosErrorShape = {
  response: {
    status: 405,
    statusText: "Method Not Allowed",
    data: "This feature is not implemented: this node does not run the `query` mode, so it serves only system table queries. Restart it with `--mode query`, or send this query to a query node in the cluster",
  },
  message: "Request failed with status code 405",
};
