interface LogMetadata {
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set(["body", "bodyMarkdown", "body_markdown", "markdown", "content"]);

function redactSensitiveFields(metadata: LogMetadata): LogMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (SENSITIVE_KEYS.has(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, value];
    })
  );
}

export interface Logger {
  info: (event: string, metadata?: LogMetadata) => void;
}

export const appLogger: Logger = {
  info(event, metadata = {}) {
    const payload = {
      level: "info",
      timestamp: new Date().toISOString(),
      event,
      metadata: redactSensitiveFields(metadata)
    };

    console.info(JSON.stringify(payload));
  }
};
