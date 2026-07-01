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
  const details = error as {
    fix?: string;
    metadata?: Record<string, unknown>;
  };
  return {
    content: [
      {
        type: "text",
        text: jsonText({
          ok: false,
          error: {
            code,
            message,
            retryable: false,
            ...(details.fix && { fix: details.fix }),
          },
          ...(details.metadata && { metadata: details.metadata }),
        }),
      },
    ],
    isError: true,
  };
}
