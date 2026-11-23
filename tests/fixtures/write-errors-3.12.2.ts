import type { AxiosErrorShape } from "./error-responses.js";

const EXPLICIT_SCHEMA_DB = "mcp_e2e_312_explicit";

const axios400 = (data: unknown): AxiosErrorShape => ({
  response: { status: 400, statusText: "Bad Request", data },
  message: "Request failed with status code 400",
});

export const BATCH_REJECTING_LINES_2_AND_3 = [
  "m,host=a v=2 1700000001",
  'm,host=a v="str" 1700000002',
  "bad line here",
  "m,host=a v=3 1700000003",
].join("\n");

export const WRITE_400_ACCEPT_PARTIAL_REJECTS_LINES_2_AND_3 = axios400({
  error: "partial write of line protocol occurred",
  data: [
    {
      error_message:
        "invalid column type for column 'v', expected iox::column_type::field::float, got iox::column_type::field::string",
      line_number: 2,
      original_line: 'm,host=a v="str" 170',
    },
    {
      error_message: "No fields were provided",
      line_number: 3,
      original_line: "bad line here",
    },
  ],
});

export const WRITE_400_NO_PARTIAL_REJECTS_LINE_2 = axios400({
  error: "line protocol parsing error",
  data: {
    error_message: "No fields were provided",
    line_number: 2,
    original_line: "bad line here",
  },
});

export const ENT_400_EXPLICIT_SCHEMA_UNDECLARED_TABLE = axios400({
  error: "partial write of line protocol occurred",
  data: [
    {
      error_message: `table 'nope' is not defined in database '${EXPLICIT_SCHEMA_DB}', which uses explicit schemas; create the table with the /api/v3/configure/table API before writing to it`,
      line_number: 1,
      original_line: "nope,host=a usage=1.",
    },
  ],
});

export const ENT_400_EXPLICIT_SCHEMA_UNDECLARED_FIELD_ON_LINE_2 = axios400({
  error: "partial write of line protocol occurred",
  data: [
    {
      error_message: `column 'temp' (iox::column_type::field::float) is not defined in table 't' of database '${EXPLICIT_SCHEMA_DB}', which uses explicit schemas; add the column with the /api/v3/configure/table API before writing to it`,
      line_number: 2,
      original_line: "t,host=a temp=2.0 17",
    },
  ],
});

export const ENT_403_WRITE_WITH_READ_ONLY_TOKEN: AxiosErrorShape = {
  response: { status: 403, statusText: "Forbidden", data: "" },
  message: "Request failed with status code 403",
};

export const ENT_401_INVALID_TOKEN: AxiosErrorShape = {
  response: {
    status: 401,
    statusText: "Unauthorized",
    data: { error: "the request was not authenticated" },
  },
  message: "Request failed with status code 401",
};

export const ENT_500_WRITE_TO_PROCESS_ONLY_NODE: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: "write buffer error: cannot write to a read-only server: must enable ingest mode",
  },
  message: "Request failed with status code 500",
};

export const CORE_429_V3_WAL_BUFFER_FULL: AxiosErrorShape = {
  response: {
    status: 429,
    statusText: "Too Many Requests",
    data: "wal buffer is full; writes are temporarily rejected, retry shortly",
    headers: {},
  } as AxiosErrorShape["response"],
  message: "Request failed with status code 429",
};

export const CORE_429_V2_WAL_BUFFER_FULL: AxiosErrorShape = {
  response: {
    status: 429,
    statusText: "Too Many Requests",
    data: {
      code: "too many requests",
      message: "write buffer error: error from wal: wal buffer full with 1 ops",
    },
    headers: {},
  } as AxiosErrorShape["response"],
  message: "Request failed with status code 429",
};

export const SYNTHETIC_429_RETRY_AFTER_2S: AxiosErrorShape = {
  response: {
    status: 429,
    statusText: "Too Many Requests",
    data: "",
    headers: { "retry-after": "2" },
  } as AxiosErrorShape["response"],
  message: "Request failed with status code 429",
};
