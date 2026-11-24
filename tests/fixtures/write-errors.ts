import type { AxiosErrorShape, SdkErrorShape } from "./error-responses.js";

export type { AxiosErrorShape, SdkErrorShape };

export const DUPLICATE_TAG_LINE = "m,region=east,region=west f=1i";

export const DUPLICATED_TAG_KEY = "region";

export const CORE_400_DUPLICATE_TAG_UNDER_PARTIAL_DATA: AxiosErrorShape = {
  response: {
    status: 400,
    statusText: "Bad Request",
    data: {
      error: "partial write of line protocol occurred",
      data: [
        {
          error_message: `invalid line protocol - multiple instances of '${DUPLICATED_TAG_KEY}' tag found`,
          line_number: 1,
          original_line: "m,region=east,region",
        },
      ],
    },
  },
  message: "Request failed with status code 400",
};

export const CORE_401_UNAUTHENTICATED: AxiosErrorShape = {
  response: {
    status: 401,
    statusText: "Unauthorized",
    data: { error: "the request was not authenticated" },
  },
  message: "Request failed with status code 401",
};

export const CORE_403_UNAUTHORIZED: AxiosErrorShape = {
  response: {
    status: 403,
    statusText: "Forbidden",
    data: { error: "the request was not authorized" },
  },
  message: "Request failed with status code 403",
};

export const CORE_413_PAYLOAD_TOO_LARGE: AxiosErrorShape = {
  response: {
    status: 413,
    statusText: "Payload Too Large",
    data: "the request body was too large: limit is 10485760 bytes",
  },
  message: "Request failed with status code 413",
};

export const CORE_422_UNPROCESSABLE: AxiosErrorShape = {
  response: {
    status: 422,
    statusText: "Unprocessable Entity",
    data: {
      error:
        "invalid column type for column 'value', expected iox::column_type::field::float, got iox::column_type::field::string",
    },
  },
  message: "Request failed with status code 422",
};

export const SYNTHETIC_503_WITHOUT_BODY: AxiosErrorShape = {
  response: {
    status: 503,
    statusText: "Service Unavailable",
    data: "",
  },
  message: "Request failed with status code 503",
};

export const CORE_500_OBJECT_BODY: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: { error: "internal error while persisting write" },
  },
  message: "Request failed with status code 500",
};

export const CORE_500_STRING_BODY: AxiosErrorShape = {
  response: {
    status: 500,
    statusText: "Internal Server Error",
    data: "internal error while persisting write",
  },
  message: "Request failed with status code 500",
};

export const CLOUD_SDK_401_UNAUTHORIZED: SdkErrorShape = {
  statusCode: 401,
  statusMessage: "Unauthorized",
  body: '{"code":"unauthorized","message":"unauthorized access"}',
  json: { code: "unauthorized", message: "unauthorized access" },
  message: "unauthorized access",
};

export const CLOUD_SDK_503_UNAVAILABLE: SdkErrorShape = {
  statusCode: 503,
  statusMessage: "Service Unavailable",
  body: '{"code":"unavailable","message":"service temporarily unavailable"}',
  json: { code: "unavailable", message: "service temporarily unavailable" },
  message: "service temporarily unavailable",
};
