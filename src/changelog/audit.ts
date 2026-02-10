import type { PoolClient } from "pg";

const FORBIDDEN_AUDIT_KEYS = new Set(["body", "body_markdown", "bodymarkdown", "markdown", "content"]);

type AuditJsonValue = string | number | boolean | null | AuditJsonObject | AuditJsonValue[];

interface AuditJsonObject {
  [key: string]: AuditJsonValue;
}

export interface AuditLogWriteInput<Action extends string = string> {
  tenantId: string | null;
  actorId: string;
  action: Action;
  postId: string;
  at?: string;
  metadata?: Record<string, unknown>;
}

function sanitizeAuditValue(value: unknown): AuditJsonValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeAuditValue(entry))
      .filter((entry): entry is AuditJsonValue => entry !== undefined);

    return sanitized;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const sanitizedObject: AuditJsonObject = {};

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUDIT_KEYS.has(key.toLowerCase())) {
      continue;
    }

    const sanitizedEntry = sanitizeAuditValue(entryValue);
    if (sanitizedEntry !== undefined) {
      sanitizedObject[key] = sanitizedEntry;
    }
  }

  if (Object.keys(sanitizedObject).length === 0) {
    return undefined;
  }

  return sanitizedObject;
}

export function sanitizeAuditMetadata(metadata?: Record<string, unknown>): Record<string, AuditJsonValue> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized = sanitizeAuditValue(metadata);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
    return undefined;
  }

  return sanitized as Record<string, AuditJsonValue>;
}

export async function writeAuditLogRow<Action extends string>(
  client: Pick<PoolClient, "query">,
  input: AuditLogWriteInput<Action>
): Promise<void> {
  const metadata = sanitizeAuditMetadata(input.metadata);
  const at = input.at ?? new Date().toISOString();

  await client.query(
    `
      INSERT INTO changelog_audit_log (tenant_id, actor_id, action, post_id, at, metadata)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
    `,
    [input.tenantId, input.actorId, input.action, input.postId, at, metadata ? JSON.stringify(metadata) : null]
  );
}
