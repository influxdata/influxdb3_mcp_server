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
    metadata?: Record<string, unknown>;
  };
  return {
    content: [
      {
        type: "text",
        text: jsonText(
          redactErrorDetails({
            ok: false,
            error: {
              ...operationErrorDetails(
                error instanceof OperationError
                  ? error
                  : new OperationError(message, details.code || code),
                code,
              ),
              ...(details.fix && { fix: redactCredentials(details.fix) }),
            },
            ...(details.metadata && { metadata: details.metadata }),
          }),
        ),
      },
    ],
    isError: true,
  };
}
