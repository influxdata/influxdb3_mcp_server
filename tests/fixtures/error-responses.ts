/**
 * Recorded InfluxDB error response fixtures.
 *
 * Axios errors (Core paths) have: error.response.status, error.response.statusText, error.response.data
 * SDK HttpError (Serverless paths) has: error.statusCode, error.statusMessage, error.body, error.json, error.message
 */

export interface AxiosErrorShape {
  response: {
    status: number;
    statusText: string;
    data: unknown;
  };
  message: string;
}

export interface SdkErrorShape {
  statusCode: number;
  statusMessage: string | undefined;
  body: string | undefined;
  json: unknown;
  message: string;
}

// ── Core / axios-based fixtures ────────────────────────────────────────────

export const CORE_404_NONEXISTENT_DB: AxiosErrorShape = {
  response: {
    status: 404,
    statusText: "Not Found",
    data: { error: "query error: database not found: nonexistent" },
  },
  message: "Request failed with status code 404",
};

export const CORE_400_BAD_WRITE: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "partial write of line protocol occurred",
      data: [
        {
          error_message: "No fields were provided",
          line_number: 1,
          original_line: "invalid line protoco",
        },
      ],
    },
  },
  message: "Request failed with status code 400",
};

export const CORE_500_INVALID_SQL: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: 'query error: error while planning query: SQL error: ParserError("Expected: an SQL statement, found: THIS at Line: 1, Column: 1")',
  },
  message: "Request failed with status code 500",
};

// ── Cloud Serverless / axios-shaped with {code, message} format ────────────

export const SERVERLESS_AXIOS_400_INVALID_QUERY: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: { code: "invalid", message: "invalid: unknown query type: sql" },
  },
  message: "Request failed with status code 400",
};

export const SERVERLESS_AXIOS_404_NONEXISTENT_BUCKET: AxiosErrorShape = {
  response: {
    status: 404,
    statusText: "Not Found",
    data: {
      code: "not found",
      message:
        'failed to initialize execute state: could not find bucket "nonexistent"',
    },
  },
  message: "Request failed with status code 404",
};

// ── Cloud Serverless / SDK HttpError fixtures ──────────────────────────────

export const SERVERLESS_SDK_400_INVALID_QUERY: SdkErrorShape = {
  statusCode: 400,
  statusMessage: "Bad Request",
  body: '{"code":"invalid","message":"invalid: unknown query type: sql"}',
  json: { code: "invalid", message: "invalid: unknown query type: sql" },
  message: "invalid: unknown query type: sql",
};

export const SERVERLESS_SDK_404_NONEXISTENT_BUCKET: SdkErrorShape = {
  statusCode: 404,
  statusMessage: "Not Found",
  body: '{"code":"not found","message":"failed to initialize execute state: could not find bucket \\"nonexistent\\""}',
  json: {
    code: "not found",
    message:
      'failed to initialize execute state: could not find bucket "nonexistent"',
  },
  message:
    'failed to initialize execute state: could not find bucket "nonexistent"',
};
