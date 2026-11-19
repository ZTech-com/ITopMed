import "server-only";
import { z } from "zod";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, requirePermission } from "../clinic/context";
import { DomainError } from "../errors";
import { uuidv7 } from "../security/crypto";
import { withRecordAccess } from "./access";

/**
 * Structured anamnesis (one row per patient) and the triage / nurse's-room
 * log. Both are clinical: read with the medical-record access rules, written
 * by clinical staff, never shown to the platform or the patient portal.
 * Audit entries carry no clinical content.
 */

const opt = <T extends z.ZodTypeAny>(s: T) => z.union([z.literal("").transform(() => undefined), s]).optional();
const yesNo = z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : v === "" || v === undefined ? undefined : v), z.boolean().optional());
const text = (max: number) => opt(z.string().trim().max(max, "validation.tooLong"));

export const historySchema = z
  .object({
    pregnancy: opt(z.enum(["NO", "YES", "UNKNOWN"])),
    pregnancyWeeks: opt(z.coerce.number().int("validation.invalid").min(1, "validation.range").max(45, "validation.range")),
    priorMyocardialInfarction: yesNo,
    diabetes: opt(z.enum(["NO", "TYPE1", "TYPE2", "OTHER"])),
    smoking: opt(z.enum(["NEVER", "FORMER", "CURRENT"])),
    hypertensionYears: opt(z.coerce.number().int("validation.invalid").min(0, "validation.range").max(100, "validation.range")),
    hereditary: text(2000),
    surgeries: text(2000),
    otherNotes: text(4000),
  })
  .refine((v) => v.pregnancy === "YES" || v.pregnancyWeeks === undefined, { message: "validation.pregnancyWeeks", path: ["pregnancyWeeks"] });

export async function getPatientHistory(ctx: ClinicContext, patientId: string, meta: RequestMeta) {
  return withRecordAccess(ctx, patientId, meta, { auditView: false }, (tx) => tx.patientHistory.findUnique({ where: { patientId } }));
}

export async function savePatientHistory(ctx: ClinicContext, patientId: string, raw: unknown, meta: RequestMeta) {
  if (!ctx.permissions.has("emr.write")) throw new DomainError("errors.forbidden");
  const input = historySchema.parse(raw);
  const data = {
    pregnancy: input.pregnancy ?? null,
    pregnancyWeeks: input.pregnancy === "YES" ? (input.pregnancyWeeks ?? null) : null,
    priorMyocardialInfarction: input.priorMyocardialInfarction ?? null,
    diabetes: input.diabetes ?? null,
    smoking: input.smoking ?? null,
    hypertensionYears: input.hypertensionYears ?? null,
    hereditary: input.hereditary ?? null,
    surgeries: input.surgeries ?? null,
    otherNotes: input.otherNotes ?? null,
    updatedById: ctx.principal.user.id,
  };
  await withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx, access) => {
    if (access.mode === "break_glass") throw new DomainError("errors.forbidden");
    await tx.patientHistory.upsert({ where: { patientId }, create: { patientId, tenantId: ctx.tenant.id, ...data }, update: data });
    await auditClinic(tx, ctx, meta, { action: "emr.history_saved", entityType: "Patient", entityId: patientId });
  });
}

// ───────────── Triage / nurse's room ─────────────

export const nursingSchema = z.object({
  kind: z.enum(["FIRST_AID", "MEDICATION", "NOTE"]),
  text: z.string().trim().min(1, "validation.required").max(2000, "validation.tooLong"),
  drug: text(200),
  dose: text(100),
  route: text(100),
  appointmentId: opt(z.uuid()),
});

/** Append-only: a wrong entry is corrected by a new one, never edited. */
export async function addNursingRecord(ctx: ClinicContext, patientId: string, raw: unknown, meta: RequestMeta): Promise<string> {
  requirePermission(ctx, "nursing.write");
  const input = nursingSchema.parse(raw);
  if (input.kind === "MEDICATION" && !input.drug) throw new DomainError("errors.drugRequired");
  const id = uuidv7();
  await withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx, access) => {
    if (access.mode === "break_glass") throw new DomainError("errors.forbidden");
    if (input.appointmentId && !(await tx.appointment.findFirst({ where: { id: input.appointmentId, patientId }, select: { id: true } }))) throw new DomainError("errors.notFound");
    await tx.nursingRecord.create({ data: { id, tenantId: ctx.tenant.id, patientId, appointmentId: input.appointmentId, kind: input.kind, text: input.text, drug: input.drug, dose: input.dose, route: input.route, recordedById: ctx.principal.user.id } });
    await auditClinic(tx, ctx, meta, { action: "nursing.recorded", entityType: "Patient", entityId: patientId, metadata: { kind: input.kind } });
  });
  return id;
}

export async function listNursingRecords(ctx: ClinicContext, patientId: string, meta: RequestMeta, take = 30) {
  return withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx) => {
    const rows = await tx.nursingRecord.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take });
    const names = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({ ...r, recordedByName: names.get(r.recordedById) ?? "—" }));
  });
}

