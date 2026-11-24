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

interface ToolErrorEnvelope {
  ok: false;
  error: { message: string; fix?: string } & Record<string, unknown>;
  [field: string]: unknown;
}

export function errorEnvelope(
  error: unknown,
  code = "tool_error",
): ToolErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const details = (error && typeof error === "object" ? error : {}) as {
    code?: string;
    fix?: string;
    supported_formats?: string[];
    rows?: unknown[];
    metadata?: Record<string, unknown>;
    write?: Record<string, unknown>;
  };
  const partialQueryRowsAsServerSent = details.rows && { rows: details.rows };
  return {
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
      ...(details.write && { write: details.write }),
    }) as ToolErrorEnvelope),
    ...partialQueryRowsAsServerSent,
  };
}

export function errorResponse(error: unknown, code = "tool_error") {
  return {
    content: [{ type: "text", text: jsonText(errorEnvelope(error, code)) }],
    isError: true,
  };
}

export function textErrorWithStructuredEnvelope(error: unknown, code: string) {
  const envelope = errorEnvelope(error, code);
  const lines = [`Error: ${envelope.error.message}`];
  if (envelope.error.fix) lines.push(envelope.error.fix);
  return {
    content: [
      { type: "text", text: lines.join("\n") },
      { type: "text", text: jsonText(envelope) },
    ],
    structuredContent: envelope,
    isError: true,
  };
}
