import "server-only";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { inClinic } from "../clinic/context";
import { DomainError } from "../errors";
import { NOTE_SECTIONS, getEncounter, saveDraft } from "./record";

/**
 * Helpers that make the doctor faster without deciding anything for them:
 * the clinic's most used diagnoses (one click fills the form) and copying the
 * previous visit's signed note into the empty sections of today's draft.
 */

/** The clinic's most used diagnoses (code + wording as the doctors wrote them). */
export async function frequentDiagnoses(ctx: ClinicContext, take = 12): Promise<{ icd10Code: string; description: string; uses: number }[]> {
  if (!ctx.permissions.has("emr.write")) return [];
  const rows = await inClinic(ctx, (tx) =>
    tx.diagnosis.groupBy({
      by: ["icd10Code", "description"],
      where: { status: { not: "ENTERED_IN_ERROR" }, recordedAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
      _count: { _all: true },
      orderBy: { _count: { icd10Code: "desc" } },
      take,
    }),
  );
  return rows.map((r) => ({ icd10Code: r.icd10Code, description: r.description, uses: r._count._all }));
}

/**
 * Fills the EMPTY sections of today's draft from the patient's last signed
 * note of an earlier visit; nothing the doctor already wrote is replaced.
 * Returns false when there is no earlier signed note.
 */
export async function copyPreviousNote(ctx: ClinicContext, encounterId: string, meta: RequestMeta): Promise<boolean> {
  const { encounter, isOwn } = await getEncounter(ctx, encounterId, meta);
  if (!isOwn) throw new DomainError("errors.notYourPatient");
  const draft = encounter.notes.find((n) => n.status === "DRAFT" && n.authorId === ctx.principal.user.id);
  if (!draft) throw new DomainError("errors.noDraftNote");
  const previous = await inClinic(ctx, (tx) =>
    tx.clinicalNote.findFirst({
      where: { patientId: encounter.patient.id, status: "SIGNED", encounterId: { not: encounter.id }, encounter: { startedAt: { lt: encounter.startedAt } } },
      orderBy: { signedAt: "desc" },
      select: { complaints: true, history: true, examination: true, assessment: true, plan: true },
    }),
  );
  if (!previous) return false;
  const merged = Object.fromEntries(NOTE_SECTIONS.map((s) => [s, (draft[s] ?? "").trim() ? draft[s] : previous[s]])) as Record<(typeof NOTE_SECTIONS)[number], string>;
  await saveDraft(ctx, draft.id, merged, meta);
  return true;
}
