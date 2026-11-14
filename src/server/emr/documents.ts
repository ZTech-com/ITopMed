import "server-only";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic } from "../clinic/context";
import { getTemplate, parseNoteContent } from "../clinic/templates";
import { DomainError } from "../errors";
import { NOTE_SECTIONS, getEncounter, saveDraft } from "./record";

/**
 * Applies a note template to the doctor's draft note: only EMPTY sections are
 * filled, so nothing the doctor already wrote is overwritten.
 */
export async function applyNoteTemplate(ctx: ClinicContext, encounterId: string, templateId: string, meta: RequestMeta) {
  const template = await getTemplate(ctx, templateId);
  if (template.kind !== "NOTE") throw new DomainError("errors.notFound");
  const { encounter, isOwn } = await getEncounter(ctx, encounterId, meta);
  if (!isOwn) throw new DomainError("errors.notYourPatient");
  const draft = encounter.notes.find((n) => n.status === "DRAFT" && n.authorId === ctx.principal.user.id);
  if (!draft) throw new DomainError("errors.noDraftNote");
  const fill = parseNoteContent(template.content);
  const merged = Object.fromEntries(NOTE_SECTIONS.map((s) => [s, (draft[s] ?? "").trim() ? draft[s] : fill[s]])) as Record<(typeof NOTE_SECTIONS)[number], string>;
  await saveDraft(ctx, draft.id, merged, meta);
}

/**
 * Everything a printed document may show for one visit. Access follows the
 * medical-record rules (care relationship, audited); printing is audited too.
 */
export async function documentForVisit(ctx: ClinicContext, encounterId: string, templateId: string, meta: RequestMeta) {
  const template = await getTemplate(ctx, templateId);
  if (template.kind !== "DOCUMENT") throw new DomainError("errors.notFound");
  const data = await getEncounter(ctx, encounterId, meta);
  const e = data.encounter;
  const extra = await inClinic(ctx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { name: true, legalName: true, address: true, contactPhone: true } });
    const doctor = e.doctorProfileId
      ? await tx.doctorProfile.findUnique({ where: { id: e.doctorProfileId }, select: { specialty: true, membership: { select: { user: { select: { fullName: true } } } } } })
      : null;
    await auditClinic(tx, ctx, meta, { action: "document.printed", entityType: "Encounter", entityId: e.id, metadata: { templateId } });
    return { tenant, doctor };
  });
  const note = [...e.notes].reverse().find((n) => n.status === "SIGNED") ?? e.notes[e.notes.length - 1] ?? null;
  return { template, encounter: e, note, ...extra };
}
