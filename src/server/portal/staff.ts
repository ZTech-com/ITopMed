import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic, requirePermission } from "../clinic/context";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { ACTIVATION_TTL_MS, hashActivationCode, newActivationCode } from "./auth";
import { sequential } from "../db";

/**
 * Front-desk side of the patient portal. Staff never see or set the patient's
 * password: they hand over a one-time activation code in person, and the
 * patient chooses their own login phone and password. The clinic role cannot
 * read password hashes (column grants).
 */
const uuid = z.uuid();

export const issueCodeSchema = z.object({
  /** How the patient agreed to portal access, if no active PATIENT_PORTAL consent exists yet. */
  consentMethod: z.enum(["PAPER_SIGNED", "VERBAL_RECORDED"]).optional(),
});

export async function getPortalAccount(ctx: ClinicContext, patientId: string) {
  requirePermission(ctx, "patients.read");
  const id = uuid.safeParse(patientId);
  if (!id.success) return null;
  return inClinic(ctx, async (tx) => {
    const [account, consent] = await sequential([
      tx.patientAccount.findFirst({
        where: { patientId: id.data, tenantId: ctx.tenant.id },
        select: { id: true, status: true, login: true, activationExpiresAt: true, activatedAt: true, lastLoginAt: true, lockedUntil: true },
      }),
      tx.patientConsent.findFirst({ where: { patientId: id.data, purpose: "PATIENT_PORTAL", withdrawnAt: null }, select: { id: true } }),
    ]);
    return { account, hasConsent: Boolean(consent) };
  });
}

/**
 * Creates the portal account (or resets it) and returns a fresh activation code.
 * The code is shown once; only its hash is stored. Reissuing invalidates the
 * previous code, the password and every open portal session.
 */
export async function issuePortalCode(ctx: ClinicContext, patientId: string, raw: unknown, meta: RequestMeta): Promise<{ code: string; expiresAt: Date }> {
  requirePermission(ctx, "portal.manage");
  const input = issueCodeSchema.parse(raw);
  const pid = uuid.safeParse(patientId);
  if (!pid.success) throw new DomainError("errors.notFound");
  const code = newActivationCode();
  const codeHash = hashActivationCode(code);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);

  await inClinic(ctx, async (tx) => {
    const patient = await tx.patient.findFirst({ where: { id: pid.data }, select: { id: true, status: true } });
    if (!patient) throw new DomainError("errors.notFound");
    if (patient.status !== "ACTIVE") throw new DomainError("errors.patientInactive");

    const consent = await tx.patientConsent.findFirst({ where: { patientId: patient.id, purpose: "PATIENT_PORTAL", withdrawnAt: null }, select: { id: true } });
    if (!consent) {
      if (!input.consentMethod) throw new DomainError("errors.portalConsentRequired");
      await tx.patientConsent.create({
        data: { id: uuidv7(), tenantId: ctx.tenant.id, patientId: patient.id, purpose: "PATIENT_PORTAL", method: input.consentMethod, recordedById: ctx.principal.user.id },
      });
      await auditClinic(tx, ctx, meta, { action: "patient.consent_recorded", entityType: "Patient", entityId: patient.id, metadata: { purpose: "PATIENT_PORTAL", method: input.consentMethod } });
    }

    const existing = await tx.patientAccount.findFirst({ where: { patientId: patient.id, tenantId: ctx.tenant.id }, select: { id: true } });
    if (!existing) {
      await tx.patientAccount.createMany({
        data: [{ id: uuidv7(), tenantId: ctx.tenant.id, patientId: patient.id, status: "INVITED", activationCodeHash: codeHash, activationExpiresAt: expiresAt, createdById: ctx.principal.user.id }],
      });
    } else {
      await tx.patientAccount.updateMany({
        where: { id: existing.id },
        data: { status: "INVITED", login: null, passwordHash: null, activationCodeHash: codeHash, activationExpiresAt: expiresAt, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.patientSession.updateMany({ where: { accountId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await auditClinic(tx, ctx, meta, { action: "portal.code_issued", entityType: "Patient", entityId: patient.id, metadata: { reissue: Boolean(existing) } });
  });
  return { code, expiresAt };
}

/** Turns portal access off (e.g. lost phone, patient request) and ends all sessions. */
export async function disablePortalAccount(ctx: ClinicContext, patientId: string, meta: RequestMeta) {
  requirePermission(ctx, "portal.manage");
  const pid = uuid.safeParse(patientId);
  if (!pid.success) throw new DomainError("errors.notFound");
  await inClinic(ctx, async (tx) => {
    const acc = await tx.patientAccount.findFirst({ where: { patientId: pid.data, tenantId: ctx.tenant.id }, select: { id: true, status: true } });
    if (!acc || acc.status === "DISABLED") throw new DomainError("errors.notFound");
    await tx.patientAccount.updateMany({ where: { id: acc.id }, data: { status: "DISABLED", activationCodeHash: null, activationExpiresAt: null } });
    await tx.patientSession.updateMany({ where: { accountId: acc.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "portal.disabled", entityType: "Patient", entityId: pid.data });
  });
}
