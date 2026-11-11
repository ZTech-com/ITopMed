import "server-only";
import type { Tx } from "./db";
import { uuidv7 } from "./security/crypto";

export type AuditActorType = "PLATFORM_USER" | "USER" | "SYSTEM" | "ANONYMOUS" | "PATIENT";
export type AuditOutcome = "SUCCESS" | "DENIED" | "FAILURE";

export interface AuditInput {
  tenantId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  outcome?: AuditOutcome;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /**
   * Operational context only. NEVER put clinical content, diagnoses, notes,
   * passwords, tokens or full documents here. Enforced by `assertSafeMetadata`.
   */
  metadata?: Record<string, string | number | boolean | null | string[]>;
}

const FORBIDDEN_KEYS = /pass(word)?|token|secret|otp|code|diagnos|note|symptom|complaint|result|prescription/i;

export function assertSafeMetadata(meta: AuditInput["metadata"]) {
  for (const k of Object.keys(meta ?? {})) {
    if (FORBIDDEN_KEYS.test(k)) throw new Error(`Audit metadata key "${k}" is not allowed`);
  }
}

/**
 * Appends to the tamper-evident audit trail inside the caller's transaction,
 * so the audit record commits atomically with the change it describes.
 * Hash chaining is done by the database trigger. Plain INSERT (no RETURNING)
 * because the inserting role may not be allowed to read the row back.
 */
export async function recordAudit(tx: Tx, e: AuditInput): Promise<void> {
  assertSafeMetadata(e.metadata);
  const ua = e.userAgent ? e.userAgent.slice(0, 256) : null;
  await tx.$executeRaw`INSERT INTO "AuditEvent"
    (id, "tenantId", "actorType", "actorId", action, "entityType", "entityId", outcome, "ipHash", "userAgent", "requestId", metadata)
    VALUES (${uuidv7()}::uuid, ${e.tenantId ?? null}::uuid, ${e.actorType}::"AuditActorType", ${e.actorId ?? null}::uuid,
            ${e.action}, ${e.entityType ?? null}, ${e.entityId ?? null}, ${e.outcome ?? "SUCCESS"}::"AuditOutcome",
            ${e.ipHash ?? null}, ${ua}, ${e.requestId ?? null}, ${JSON.stringify(e.metadata ?? {})}::jsonb)`;
}
