import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DIAGNOSTIC_FILE_MAX_BYTES, DIAGNOSTIC_KINDS, parseDiagnosticData, sniffFileType, type DiagnosticKindKey } from "@/lib/diagnostics";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic } from "../clinic/context";
import { DomainError } from "../errors";
import { uuidv7 } from "../security/crypto";
import { withRecordAccess } from "./access";
import { loadEncounter } from "./record";

/**
 * Diagnostic studies (ECG, echo, ultrasound, Holter, ABPM, stress test…):
 * values entered from the device or paper, a written conclusion, and attached
 * images / PDFs. Clinical data under the medical-record access rules; whoever
 * writes clinical notes (emr.write) and has a care relationship may enter a
 * result - the ultrasound or echo doctor need not be the treating doctor.
 */

const uuid = z.uuid();

export const resultSchema = z.object({
  encounterId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  kind: z.enum(DIAGNOSTIC_KINDS),
  title: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  conclusion: z.string().trim().min(1, "validation.required").max(10_000, "validation.tooLong"),
});

export async function addDiagnosticResult(ctx: ClinicContext, patientId: string, raw: Record<string, string>, meta: RequestMeta): Promise<string> {
  if (!ctx.permissions.has("emr.write")) throw new DomainError("errors.forbidden");
  const input = resultSchema.parse(raw);
  const { data, errors } = parseDiagnosticData(input.kind as DiagnosticKindKey, raw);
  if (errors.length) throw new DomainError("errors.diagnosticValue");
  const id = uuidv7();
  await withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx, access) => {
    if (access.mode === "break_glass") throw new DomainError("errors.forbidden");
    if (input.encounterId) {
      const e = await loadEncounter(tx, input.encounterId);
      if (e.patientId !== patientId) throw new DomainError("errors.notFound");
    }
    await tx.diagnosticResult.create({ data: { id, tenantId: ctx.tenant.id, patientId, encounterId: input.encounterId, kind: input.kind, title: input.title, data, conclusion: input.conclusion, performedById: ctx.principal.user.id } });
    await auditClinic(tx, ctx, meta, { action: "diagnostic.recorded", entityType: "DiagnosticResult", entityId: id, metadata: { kind: input.kind } });
  });
  return id;
}

export async function listDiagnosticResults(ctx: ClinicContext, patientId: string, meta: RequestMeta) {
  return withRecordAccess(ctx, patientId, meta, { auditView: false }, async (tx) => {
    const rows = await tx.diagnosticResult.findMany({
      where: { patientId },
      orderBy: { performedAt: "desc" },
      take: 100,
      include: { files: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true }, orderBy: { createdAt: "asc" } } },
    });
    const names = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.performedById))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({ ...r, data: r.data as Record<string, string | number>, performedByName: names.get(r.performedById) ?? "—" }));
  });
}

async function loadResult(ctx: ClinicContext, resultId: string) {
  if (!uuid.safeParse(resultId).success) throw new DomainError("errors.notFound");
  const r = await inClinic(ctx, (tx) => tx.diagnosticResult.findUnique({ where: { id: resultId }, select: { id: true, patientId: true, performedById: true, enteredInErrorAt: true } }));
  if (!r) throw new DomainError("errors.notFound");
  return r;
}

/** One result with everything needed to print it. Printing is audited. */
export async function diagnosticForPrint(ctx: ClinicContext, resultId: string, meta: RequestMeta) {
  const r = await loadResult(ctx, resultId);
  return withRecordAccess(ctx, r.patientId, meta, { auditView: false }, async (tx) => {
    const result = await tx.diagnosticResult.findUniqueOrThrow({ where: { id: resultId }, include: { files: { select: { id: true, fileName: true, mimeType: true } } } });
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: r.patientId }, select: { mrn: true, lastName: true, firstName: true, middleName: true, birthDate: true, birthYearOnly: true, sex: true } });
    const author = await tx.user.findUnique({ where: { id: result.performedById }, select: { fullName: true } });
    await auditClinic(tx, ctx, meta, { action: "diagnostic.printed", entityType: "DiagnosticResult", entityId: resultId });
    return { result: { ...result, data: result.data as Record<string, string | number> }, patient, authorName: author?.fullName ?? "—" };
  });
}

/** A wrong result is not deleted: it is marked "entered in error" by its author. */
export async function markDiagnosticError(ctx: ClinicContext, resultId: string, meta: RequestMeta) {
  const r = await loadResult(ctx, resultId);
  if (r.performedById !== ctx.principal.user.id) throw new DomainError("errors.forbidden");
  if (r.enteredInErrorAt) return;
  await withRecordAccess(ctx, r.patientId, meta, { auditView: false }, async (tx) => {
    await tx.diagnosticResult.update({ where: { id: resultId }, data: { enteredInErrorAt: new Date() }, select: { id: true } });
    await auditClinic(tx, ctx, meta, { action: "diagnostic.entered_in_error", entityType: "DiagnosticResult", entityId: resultId });
  });
}

const safeName = (name: string) =>
   
  name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 200) || "file";

/** Attaches an image or PDF. The real type is read from the bytes; the browser's claim is ignored. */
export async function addDiagnosticFile(ctx: ClinicContext, resultId: string, file: { name: string; bytes: Uint8Array }, meta: RequestMeta): Promise<string> {
  if (!ctx.permissions.has("emr.write")) throw new DomainError("errors.forbidden");
  if (file.bytes.length === 0 || file.bytes.length > DIAGNOSTIC_FILE_MAX_BYTES) throw new DomainError("errors.fileTooLarge");
  const mime = sniffFileType(file.bytes);
  if (!mime) throw new DomainError("errors.fileType");
  const r = await loadResult(ctx, resultId);
  if (r.enteredInErrorAt) throw new DomainError("errors.invalidTransition");
  const id = uuidv7();
  await withRecordAccess(ctx, r.patientId, meta, { auditView: false }, async (tx, access) => {
    if (access.mode === "break_glass") throw new DomainError("errors.forbidden");
    if ((await tx.diagnosticFile.count({ where: { resultId } })) >= 20) throw new DomainError("errors.tooManyFiles");
    await tx.diagnosticFile.create({
      data: { id, tenantId: ctx.tenant.id, resultId, fileName: safeName(file.name), mimeType: mime, sizeBytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex"), content: Buffer.from(file.bytes), uploadedById: ctx.principal.user.id },
      select: { id: true },
    });
    await auditClinic(tx, ctx, meta, { action: "diagnostic.file_added", entityType: "DiagnosticResult", entityId: resultId, metadata: { mime, sizeBytes: file.bytes.length } });
  });
  return id;
}

/** File content for viewing; access follows the record rules and is audited. */
export async function getDiagnosticFile(ctx: ClinicContext, fileId: string, meta: RequestMeta) {
  if (!uuid.safeParse(fileId).success) throw new DomainError("errors.notFound");
  const head = await inClinic(ctx, (tx) => tx.diagnosticFile.findUnique({ where: { id: fileId }, select: { resultId: true } }));
  if (!head) throw new DomainError("errors.notFound");
  const r = await loadResult(ctx, head.resultId);
  return withRecordAccess(ctx, r.patientId, meta, { auditView: false }, async (tx) => {
    const f = await tx.diagnosticFile.findUniqueOrThrow({ where: { id: fileId }, select: { fileName: true, mimeType: true, content: true } });
    await auditClinic(tx, ctx, meta, { action: "diagnostic.file_viewed", entityType: "DiagnosticResult", entityId: head.resultId });
    return f;
  });
}
