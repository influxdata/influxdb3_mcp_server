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
          },
        }),
      },
    ],
    isError: true,
  };
}
