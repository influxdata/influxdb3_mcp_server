import {
  operationErrorDetails,
  OperationError,
  redactCredentials,
  redactErrorDetails,
} from "../services/error-resolution.service.js";

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function okResponse(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: jsonText(value),
      },
    ],
  };
}

export function errorResponse(error: unknown, code = "tool_error") {
  const message = error instanceof Error ? error.message : String(error);
  const details = (error && typeof error === "object" ? error : {}) as {
    code?: string;
    fix?: string;
    supported_formats?: string[];
    rows?: unknown[];
    metadata?: Record<string, unknown>;
  };
  return {
    content: [
      {
        type: "text",
        text: jsonText({
          ...(redactErrorDetails({
            ok: false,
            error: {
              ...operationErrorDetails(
                error instanceof OperationError
                  ? error
                  : new OperationError(message, details.code || code),
                code,
              ),
              ...(details.fix && { fix: redactCredentials(details.fix) }),
              ...(details.supported_formats && {
                supported_formats: details.supported_formats,
              }),
            },
            ...(details.metadata && { metadata: details.metadata }),
          }) as object),
          // Rows received before an interruption are query data, not error
          // text, so they are returned as the server sent them.
          ...(details.rows && { rows: details.rows }),
        }),
      },
    ],
    isError: true,
  };
}
