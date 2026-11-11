import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, canUseBranch, inClinic } from "../clinic/context";
import type { Tx } from "../db";
import { addDays, instantToLocalDate, localToInstant } from "../scheduling/time";
import { DomainError } from "../tenancy/provisioning";

/** How long after the last visit a doctor keeps routine access to a patient's record. */
const CARE_LOOKBACK_DAYS = 365;
/** Booked visits in the near future also establish a care relationship (preparation). */
const CARE_LOOKAHEAD_DAYS = 30;

export type AccessMode = "care" | "oversight" | "break_glass";

/**
 * Break-the-glass reasons are categories, not free text: the audit trail is
 * readable by administrators without clinical access, so it must never carry
 * clinical details.
 */
export const BREAK_GLASS_REASONS = ["EMERGENCY", "COVERING_COLLEAGUE", "CONSULTATION_REQUEST", "CONTINUITY_OF_CARE"] as const;
export type BreakGlassReason = (typeof BREAK_GLASS_REASONS)[number];

class AccessDenied extends Error {}

export interface RecordAccess {
  mode: AccessMode;
  /** The caller's own practitioner profile, if any. */
  doctorProfileId: string | null;
}

/**
 * Contextual access control (ABAC) for the medical record, on top of RBAC and RLS:
 *  - `emr.read_all` (head doctor): oversight access, audited.
 *  - doctor: care relationship = a non-cancelled appointment or an encounter with
 *    this patient within the last 365 days or the next 30 days.
 *  - other clinical staff (nurses): the patient has a visit today in one of their branches.
 *  - otherwise only "break the glass" with a reason category, audited as a
 *    security event for review. Without it, access is denied — and the denial is audited.
 */
async function decide(tx: Tx, ctx: ClinicContext, patientId: string, breakGlass?: BreakGlassReason): Promise<RecordAccess> {
  if (!ctx.permissions.has("emr.read")) throw new DomainError("errors.forbidden");
  const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) throw new DomainError("errors.notFound");
  const own = await tx.doctorProfile.findUnique({ where: { membershipId: ctx.membershipId }, select: { id: true } });
  const doctorProfileId = own?.id ?? null;

  if (ctx.permissions.has("emr.read_all")) return { mode: "oversight", doctorProfileId };

  if (own) {
    const now = Date.now();
    const window = { gte: new Date(now - CARE_LOOKBACK_DAYS * 86_400_000), lte: new Date(now + CARE_LOOKAHEAD_DAYS * 86_400_000) };
    const visit = await tx.appointment.findFirst({ where: { patientId, doctorProfileId: own.id, status: { not: "CANCELLED" }, startsAt: window }, select: { id: true } });
    if (visit) return { mode: "care", doctorProfileId };
    const enc = await tx.encounter.findFirst({ where: { patientId, doctorProfileId: own.id, startedAt: { gte: window.gte } }, select: { id: true } });
    if (enc) return { mode: "care", doctorProfileId };
  } else {
    const tz = ctx.tenant.timezone;
    const today = instantToLocalDate(new Date(), tz);
    const visits = await tx.appointment.findMany({
      where: { patientId, status: { in: ["BOOKED", "CHECKED_IN", "IN_PROGRESS"] }, startsAt: { gte: localToInstant(today, 0, tz), lt: localToInstant(addDays(today, 1), 0, tz) } },
      select: { branchId: true },
    });
    if (visits.some((v) => canUseBranch(ctx, v.branchId))) return { mode: "care", doctorProfileId };
  }

  if (breakGlass) return { mode: "break_glass", doctorProfileId };
  throw new AccessDenied();
}

/**
 * Runs `fn` with access to one patient's record. Writes "emr.viewed" (or the
 * mutating action's own event) inside the same transaction; a denial is
 * recorded in a separate transaction so it survives the rollback.
 */
export async function withRecordAccess<T>(
  ctx: ClinicContext,
  patientId: string,
  meta: RequestMeta,
  opts: { breakGlass?: BreakGlassReason; auditView?: boolean },
  fn: (tx: Tx, access: RecordAccess) => Promise<T>,
): Promise<T> {
  if (!z.uuid().safeParse(patientId).success) throw new DomainError("errors.notFound");
  if (opts.breakGlass && !(BREAK_GLASS_REASONS as readonly string[]).includes(opts.breakGlass)) throw new DomainError("errors.invalidInput");
  try {
    return await inClinic(ctx, async (tx) => {
      const access = await decide(tx, ctx, patientId, opts.breakGlass);
      if (access.mode === "break_glass") {
        await auditClinic(tx, ctx, meta, { action: "emr.break_glass", entityType: "Patient", entityId: patientId, metadata: { reason: opts.breakGlass! } });
      }
      if (opts.auditView !== false) {
        await auditClinic(tx, ctx, meta, { action: "emr.viewed", entityType: "Patient", entityId: patientId, metadata: { mode: access.mode } });
      }
      return fn(tx, access);
    });
  } catch (e) {
    if (e instanceof AccessDenied) {
      await inClinic(ctx, (tx) => auditClinic(tx, ctx, meta, { action: "emr.access_denied", entityType: "Patient", entityId: patientId }));
      throw new DomainError("errors.noCareRelationship");
    }
    throw e;
  }
}
