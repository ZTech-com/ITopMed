import "server-only";
import { z } from "zod";
import type { ToothCondition } from "@/generated/prisma/client";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic } from "../clinic/context";
import type { Tx } from "../db";
import { uuidv7 } from "../security/crypto";
import { DomainError } from "../tenancy/provisioning";
import { withRecordAccess } from "./access";

/**
 * Dental chart (odontogram), module "dental". FDI two-digit numbering.
 * Entries are append-only (database trigger); the newest entry for a tooth is
 * its current state, earlier ones are its history.
 */
export const TOOTH_CONDITIONS = ["HEALTHY", "CARIES", "FILLED", "CROWN", "ROOT_CANAL", "IMPLANT", "MISSING", "TO_EXTRACT"] as const satisfies readonly ToothCondition[];
export const SURFACES = ["M", "O", "D", "B", "L"] as const;

/** Chart layout as the dentist faces the patient: patient's right on the left. */
export const DENTITION = {
  permanent: {
    upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
    lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
  },
  primary: {
    upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
    lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
  },
} as const;

export function isFdiTooth(n: number): boolean {
  const q = Math.floor(n / 10);
  const t = n % 10;
  return (q >= 1 && q <= 4 && t >= 1 && t <= 8) || (q >= 5 && q <= 8 && t >= 1 && t <= 5);
}

export const toothEntrySchema = z.object({
  tooth: z.coerce.number().int().refine(isFdiTooth, "validation.tooth"),
  condition: z.enum(TOOTH_CONDITIONS),
  surfaces: z.array(z.enum(SURFACES)).max(5).default([]),
});

export interface ToothState {
  condition: ToothCondition;
  surfaces: string[];
  recordedAt: Date;
}

/** Current state per tooth + recent history (inside an access-checked transaction). */
export async function dentalChartForRecord(tx: Tx, patientId: string) {
  const entries = await tx.dentalChartEntry.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: 500 });
  const current = new Map<number, ToothState>();
  for (const e of entries) if (!current.has(e.tooth)) current.set(e.tooth, { condition: e.condition, surfaces: e.surfaces, recordedAt: e.recordedAt });
  return { current: Object.fromEntries(current) as Record<number, ToothState>, history: entries.slice(0, 30) };
}

/** The treating doctor records a tooth's condition during their open visit. */
export async function recordTooth(ctx: ClinicContext, encounterId: string, raw: unknown, meta: RequestMeta) {
  if (!ctx.modules.has("dental")) throw new DomainError("errors.moduleDisabled");
  if (!ctx.permissions.has("emr.write")) throw new DomainError("errors.forbidden");
  const input = toothEntrySchema.parse(raw);
  // Surfaces only make sense for conditions on part of a tooth.
  const surfaces = input.condition === "CARIES" || input.condition === "FILLED" ? [...new Set(input.surfaces)] : [];
  const enc = await inClinic(ctx, async (tx) => {
    const e = await tx.encounter.findUnique({ where: { id: z.uuid().parse(encounterId) } });
    if (!e) throw new DomainError("errors.notFound");
    return e;
  });
  await withRecordAccess(ctx, enc.patientId, meta, { auditView: false }, async (tx, access) => {
    if (enc.doctorProfileId !== access.doctorProfileId) throw new DomainError("errors.notYourPatient");
    if (enc.status !== "OPEN") throw new DomainError("errors.encounterClosed");
    const id = uuidv7();
    await tx.dentalChartEntry.create({
      data: { id, tenantId: ctx.tenant.id, patientId: enc.patientId, encounterId: enc.id, tooth: input.tooth, surfaces, condition: input.condition, recordedById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, { action: "dental.recorded", entityType: "Patient", entityId: enc.patientId });
  });
}
