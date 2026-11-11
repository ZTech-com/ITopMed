import "server-only";
import { z } from "zod";
import type { SupportAccessGrant, SupportAccessScope } from "@/generated/prisma/client";
import { recordAudit } from "../audit";
import type { ClinicContext } from "../auth/clinic-auth";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan } from "../authz/platform";
import { platformDb, withAppContext, withPlatform } from "../db";
import { hashIp, uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";

/** Unanswered requests lapse after this long. */
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Clinical-record support access stays OFF until the legal assessment in
 * docs/SECURITY-AND-PRIVACY.md is complete. Changing this requires sign-off.
 */
export const CLINICAL_SUPPORT_ACCESS_ENABLED = false;

export const supportRequestSchema = z.object({
  scope: z.enum(["CONFIGURATION", "OPERATIONAL", "CLINICAL_READ"]),
  durationMinutes: z.coerce.number().int().min(5, "validation.durationRange").max(480, "validation.durationRange"),
  reason: z.string().trim().min(10, "validation.reasonTooShort").max(500, "validation.tooLong"),
  ticketRef: z
    .string()
    .trim()
    .max(64, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export type EffectiveGrantStatus = "REQUESTED" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";

/** Status as the user should see it right now (time-based expiry is computed, not stored). */
export function effectiveStatus(g: Pick<SupportAccessGrant, "status" | "requestedAt" | "expiresAt">, now = new Date()): EffectiveGrantStatus {
  if (g.status === "APPROVED" && g.expiresAt && g.expiresAt <= now) return "EXPIRED";
  if (g.status === "REQUESTED" && now.getTime() - g.requestedAt.getTime() > REQUEST_TTL_MS) return "EXPIRED";
  return g.status;
}

export async function requestSupportAccess(actor: PlatformPrincipal, tenantId: string, raw: unknown, meta: RequestMeta) {
  if (!actor.mfaVerified) throw new DomainError("errors.mfaRequired");
  if (!platformCan(actor.user.role, "support.request_access")) throw new DomainError("errors.forbidden");
  const input = supportRequestSchema.parse(raw);
  if (input.scope === "CLINICAL_READ" && !CLINICAL_SUPPORT_ACCESS_ENABLED) throw new DomainError("errors.clinicalAccessDisabled");
  const id = uuidv7();
  await withPlatform(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    if (!tenant || tenant.status === "ARCHIVED") throw new DomainError("errors.notFound");
    await tx.supportAccessGrant.create({
      data: {
        id,
        tenantId,
        platformUserId: actor.user.id,
        requesterName: actor.user.fullName,
        requesterEmail: actor.user.email,
        scope: input.scope,
        reason: input.reason,
        ticketRef: input.ticketRef,
        durationMinutes: input.durationMinutes,
      },
    });
    await recordAudit(tx, {
      tenantId,
      actorType: "PLATFORM_USER",
      actorId: actor.user.id,
      action: "support_access.requested",
      entityType: "SupportAccessGrant",
      entityId: id,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      metadata: { scope: input.scope, durationMinutes: input.durationMinutes },
    });
  });
  return id;
}

export async function listGrantsForPlatform(actor: PlatformPrincipal, tenantId: string) {
  if (!platformCan(actor.user.role, "tenants.read")) throw new DomainError("errors.forbidden");
  return platformDb().supportAccessGrant.findMany({ where: { tenantId }, orderBy: { requestedAt: "desc" }, take: 20 });
}

/**
 * Returns the caller's currently active grant covering `scope`, or null.
 * OPERATIONAL also covers CONFIGURATION. Every data access performed under a
 * grant must be audited with the grant id (see withSupportAccess).
 */
export async function getActiveGrant(platformUserId: string, tenantId: string, scope: SupportAccessScope) {
  const covering: SupportAccessScope[] = scope === "CONFIGURATION" ? ["CONFIGURATION", "OPERATIONAL"] : [scope];
  const now = new Date();
  return platformDb().supportAccessGrant.findFirst({
    where: { platformUserId, tenantId, status: "APPROVED", scope: { in: covering }, revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });
}

// ───────────── Clinic side ─────────────

export async function listGrantsForClinic(ctx: ClinicContext) {
  if (!ctx.permissions.has("support_access.decide")) throw new DomainError("errors.forbidden");
  return withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, (tx) =>
    tx.supportAccessGrant.findMany({ orderBy: { requestedAt: "desc" }, take: 50 }),
  );
}

export type GrantDecision = "approve" | "deny" | "revoke";

/** Only the clinic decides. Approval starts the clock; access ends automatically. */
export async function decideGrant(ctx: ClinicContext, grantId: string, decision: GrantDecision, meta: RequestMeta) {
  if (!ctx.permissions.has("support_access.decide")) throw new DomainError("errors.forbidden");
  if (!z.uuid().safeParse(grantId).success) throw new DomainError("errors.notFound");
  await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, async (tx) => {
    const g = await tx.supportAccessGrant.findUnique({ where: { id: grantId } });
    if (!g) throw new DomainError("errors.notFound");
    const status = effectiveStatus(g);
    const now = new Date();
    if (decision === "revoke") {
      if (status !== "APPROVED") throw new DomainError("errors.grantNotActive");
      await tx.supportAccessGrant.update({ where: { id: g.id }, data: { status: "REVOKED", revokedAt: now } });
    } else {
      if (status !== "REQUESTED") throw new DomainError("errors.grantNotPending");
      if (decision === "approve" && g.scope === "CLINICAL_READ" && !CLINICAL_SUPPORT_ACCESS_ENABLED) throw new DomainError("errors.clinicalAccessDisabled");
      await tx.supportAccessGrant.update({
        where: { id: g.id },
        data:
          decision === "approve"
            ? { status: "APPROVED", decidedAt: now, decidedByUserId: ctx.principal.user.id, startsAt: now, expiresAt: new Date(now.getTime() + g.durationMinutes * 60_000) }
            : { status: "DENIED", decidedAt: now, decidedByUserId: ctx.principal.user.id },
      });
    }
    await recordAudit(tx, {
      tenantId: ctx.tenant.id,
      actorType: "USER",
      actorId: ctx.principal.user.id,
      action: `support_access.${decision === "approve" ? "approved" : decision === "deny" ? "denied" : "revoked"}`,
      entityType: "SupportAccessGrant",
      entityId: g.id,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      metadata: { scope: g.scope },
    });
  });
}
