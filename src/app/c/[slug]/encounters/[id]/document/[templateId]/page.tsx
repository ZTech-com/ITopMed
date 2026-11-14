import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { formatBirthDate, patientName } from "@/components/patients";
import { PrintButton } from "@/components/print-button";
import { requireClinic } from "@/server/auth/guards";
import { renderDocument } from "@/server/clinic/templates";
import { documentForVisit } from "@/server/emr/documents";
import { DomainError } from "@/server/errors";
import { requestMeta } from "@/server/http";

/** Prints one of the clinic's document templates for this visit (A4/A5). */
export default async function VisitDocumentPage({ params }: { params: Promise<{ slug: string; id: string; templateId: string }> }) {
  const { slug, id, templateId } = await params;
  const ctx = await requireClinic(slug, "emr.read");
  const d = await documentForVisit(ctx, id, templateId, await requestMeta()).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const tz = ctx.tenant.timezone;
  const e = d.encounter;
  const text = renderDocument(d.template.content, {
    "patient.fullName": patientName(e.patient),
    "patient.birthDate": await formatBirthDate(e.patient.birthDate),
    "patient.mrn": e.patient.mrn,
    "patient.sex": t(`sex.${e.patient.sex}` as never),
    "visit.date": format.dateTime(e.startedAt, { dateStyle: "long", timeZone: tz }),
    "doctor.fullName": d.doctor?.membership.user.fullName ?? "",
    "doctor.specialty": d.doctor ? t(`specialties.${d.doctor.specialty}` as never) : "",
    "clinic.name": d.tenant.legalName ?? d.tenant.name,
    "clinic.address": d.tenant.address ?? "",
    "clinic.phone": d.tenant.contactPhone ?? "",
    "note.complaints": d.note?.complaints ?? "",
    "note.history": d.note?.history ?? "",
    "note.examination": d.note?.examination ?? "",
    "note.assessment": d.note?.assessment ?? "",
    "note.plan": d.note?.plan ?? "",
    diagnoses: e.diagnoses.map((x) => `${x.icd10Code} — ${x.description}`).join("\n"),
    prescriptions: e.prescriptions
      .filter((p) => p.status === "ACTIVE")
      .map((p, i) => `${i + 1}. ${p.drug}: ${[p.dose, p.frequency, p.route, p.durationDays ? t("clinic.rx.days", { count: p.durationDays }) : null].filter(Boolean).join(", ")}`)
      .join("\n"),
    today: format.dateTime(new Date(), { dateStyle: "long", timeZone: tz }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 print:max-w-none">
      <div className="flex justify-end print:hidden">
        <PrintButton label={t("clinic.rx.printNow")} />
      </div>
      <article className="space-y-4 rounded-[16px] border border-border bg-surface p-6 text-[14.5px] leading-relaxed print:border-0 print:p-0">
        <header className="border-b border-border pb-3 text-center">
          <p className="text-[16px] font-semibold">{d.tenant.legalName ?? d.tenant.name}</p>
          {d.tenant.address ? <p className="text-[12px] text-text-2">{d.tenant.address}</p> : null}
          {d.tenant.contactPhone ? <p className="text-[12px] text-text-2">{d.tenant.contactPhone}</p> : null}
        </header>
        <h1 className="text-center text-[18px] font-semibold tracking-[0.04em]">{d.template.name}</h1>
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
      </article>
    </div>
  );
}
