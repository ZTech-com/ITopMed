import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic } from "../clinic/context";
import { DomainError } from "../errors";
import { uuidv7 } from "../security/crypto";
import { withRecordAccess } from "./access";
import { loadEncounter, ownOpenEncounter } from "./record";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "validation.tooLong")
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const prescriptionSchema = z.object({
  drug: z.string().trim().min(2, "validation.required").max(200, "validation.tooLong"),
  dose: z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"),
  frequency: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  route: optionalText(60),
  durationDays: z.union([z.literal("").transform(() => undefined), z.coerce.number().int("validation.invalid").min(1, "validation.durationDays").max(3650, "validation.durationDays")]).optional(),
  instructions: optionalText(1000),
  allergyOverride: z.boolean().default(false),
});

/**
 * Simple allergy screen: an ACTIVE recorded allergy whose substance (or a word
 * of it) appears in the medicine name, case-insensitive — allergy "Penicillin"
 * matches "Penicillin V 500 mg". It is a safety net, not a drug-interaction or
 * cross-reactivity database: the prescriber must confirm to proceed.
 */
export function allergyMatches(drug: string, substances: string[]): string[] {
  const d = drug.toLocaleLowerCase();
  return substances.filter((s) => {
    const k = s.trim().toLocaleLowerCase();
    return k.length >= 3 && (d.includes(k) || k.split(/[\s,/]+/).some((w) => w.length >= 4 && d.includes(w)));
  });
}

/** Doctor prescribes a medicine during their own open visit. */
export async function addPrescription(ctx: ClinicContext, encounterId: string, raw: unknown, meta: RequestMeta) {
  if (!ctx.permissions.has("prescriptions.write")) throw new DomainError("errors.forbidden");
  const input = prescriptionSchema.parse(raw);
  const enc = await inClinic(ctx, (tx) => loadEncounter(tx, encounterId));
  return withRecordAccess(ctx, enc.patientId, meta, { auditView: false }, async (tx, access) => {
    await ownOpenEncounter(tx, enc.id, access.doctorProfileId);
    const allergies = await tx.allergy.findMany({ where: { patientId: enc.patientId, status: "ACTIVE" }, select: { substance: true } });
    const conflicts = allergyMatches(input.drug, allergies.map((a) => a.substance));
    if (conflicts.length > 0 && !input.allergyOverride) throw new DomainError("errors.allergyConflict");
    const id = uuidv7();
    await tx.prescription.create({
      data: {
        id,
        tenantId: ctx.tenant.id,
        patientId: enc.patientId,
        encounterId: enc.id,
        prescribedById: ctx.principal.user.id,
        drug: input.drug,
        dose: input.dose,
        frequency: input.frequency,
        route: input.route ?? null,
        durationDays: input.durationDays ?? null,
        instructions: input.instructions ?? null,
        allergyOverride: conflicts.length > 0,
      },
    });
    await auditClinic(tx, ctx, meta, { action: "prescription.created", entityType: "Prescription", entityId: id, metadata: { allergyOverride: conflicts.length > 0 } });
    return { id, allergyOverride: conflicts.length > 0 };
  });
}

/** Mistakes are cancelled (kept for the record), never edited or deleted. Only the prescriber. */
export async function cancelPrescription(ctx: ClinicContext, prescriptionId: string, meta: RequestMeta) {
  if (!ctx.permissions.has("prescriptions.write")) throw new DomainError("errors.forbidden");
  if (!z.uuid().safeParse(prescriptionId).success) throw new DomainError("errors.notFound");
  const rx = await inClinic(ctx, (tx) => tx.prescription.findUnique({ where: { id: prescriptionId }, select: { id: true, patientId: true, prescribedById: true, status: true } }));
  if (!rx) throw new DomainError("errors.notFound");
  if (rx.prescribedById !== ctx.principal.user.id) throw new DomainError("errors.notYourPatient");
  if (rx.status !== "ACTIVE") throw new DomainError("errors.invalidTransition");
  await withRecordAccess(ctx, rx.patientId, meta, { auditView: false }, async (tx) => {
    const r = await tx.prescription.updateMany({ where: { id: rx.id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.principal.user.id } });
    if (r.count !== 1) throw new DomainError("errors.invalidTransition");
    await auditClinic(tx, ctx, meta, { action: "prescription.cancelled", entityType: "Prescription", entityId: rx.id });
  });
}
