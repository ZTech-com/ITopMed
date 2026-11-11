import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AllergyBanner, DiagnosisList, SignedNote, VitalsTable } from "@/components/clinical";
import { formatBirthDate, patientName } from "@/components/patients";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { BREAK_GLASS_REASONS, type BreakGlassReason } from "@/server/emr/access";
import { getMedicalRecord } from "@/server/emr/record";
import { requestMeta } from "@/server/http";
import { DomainError } from "@/server/tenancy/provisioning";
import { amendAction, breakGlassAction, clinicalStatusAction } from "../../../../../care-actions";
import { cookies } from "next/headers";

/**
 * The patient's medical record. Access follows the care relationship; anyone
 * else may only "break the glass" with a reason category (audited). The choice is
 * made by a POST action and kept in a short-lived cookie scoped to this patient.
 */
export default async function RecordPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug);
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  if (!ctx.permissions.has("emr.read")) {
    return (
      <div className="max-w-2xl">
        <Alert tone="neutral">{t("clinic.record.noClinicalAccess")}</Alert>
      </div>
    );
  }
  // Set only by the POST break-glass action (origin-checked), scoped to this patient, 10 minutes.
  const bgRaw = (await cookies()).get(`itm_bg_${id}`)?.value;
  const breakGlass = (BREAK_GLASS_REASONS as readonly string[]).includes(bgRaw ?? "") ? (bgRaw as BreakGlassReason) : undefined;

  let record: Awaited<ReturnType<typeof getMedicalRecord>>;
  try {
    record = await getMedicalRecord(ctx, id, await requestMeta(), { breakGlass });
  } catch (e) {
    if (e instanceof DomainError && e.code === "errors.notFound") notFound();
    if (e instanceof DomainError && e.code === "errors.noCareRelationship") {
      return (
        <div className="max-w-2xl space-y-6">
          <PageHeader title={t("clinic.record.title")} />
          <Card>
            <CardBody className="space-y-4">
              <p className="flex items-center gap-2 text-[16px] font-semibold">
                <ShieldAlert aria-hidden className="size-5 text-warning" />
                {t("clinic.record.breakGlassTitle")}
              </p>
              <p className="text-[14px] text-text-2">{t("clinic.record.breakGlassBody")}</p>
              <form action={breakGlassAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                <input type="hidden" name="patientId" value={id} />
                <label className="flex-1">
                  <span className="mb-1.5 block text-[13px] font-medium">{t("clinic.record.breakGlassReason")}</span>
                  <select name="bg" className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px]">
                    {BREAK_GLASS_REASONS.map((r) => (
                      <option key={r} value={r}>{t(`breakGlass.${r}`)}</option>
                    ))}
                  </select>
                </label>
                <button className={buttonClass("danger", "lg")}>{t("clinic.record.breakGlassSubmit")}</button>
              </form>
            </CardBody>
          </Card>
        </div>
      );
    }
    throw e;
  }

  const { patient, allergies, diagnoses, vitals, encounters, access } = record;
  const tz = ctx.tenant.timezone;
  const s = ctx.tenant.slug;
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={`${t("clinic.record.title")} · ${patient.mrn}`}
        title={patientName(patient)}
        description={`${await formatBirthDate(patient.birthDate)} · ${t(`sex.${patient.sex}`)}`}
        action={<Badge tone={access.mode === "break_glass" ? "danger" : "neutral"}>{t("clinic.record.accessAs", { mode: t(`accessMode.${access.mode}`) })}</Badge>}
      />
      <AllergyBanner allergies={allergies.filter((a) => a.status === "ACTIVE")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("clinic.visit.diagnoses")} />
          <CardBody>
            <DiagnosisList diagnoses={diagnoses} statusAction={clinicalStatusAction} slug={s} canEdit={ctx.permissions.has("emr.write") && access.mode === "care"} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("clinic.visit.vitals")} />
          <CardBody>
            <VitalsTable vitals={vitals.slice(0, 9)} timeZone={tz} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("clinic.record.encounters")} />
        {encounters.length === 0 ? (
          <CardBody><p className="text-[14px] text-text-2">{t("clinic.record.noEncounters")}</p></CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {encounters.map((e) => (
              <li key={e.id} className="space-y-3 px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold">
                    {format.dateTime(e.startedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })}
                    <span className="font-normal text-text-2">
                      {" "}
                      · {e.doctor.membership.user.fullName} · {t(`specialties.${e.doctor.specialty}` as never)}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Badge>
                    {e.status === "OPEN" && e.doctorProfileId === access.doctorProfileId ? (
                      <Link href={`/c/${s}/encounters/${e.id}`} className={buttonClass("secondary", "sm")}>{t("clinic.visit.continue")}</Link>
                    ) : null}
                  </div>
                </div>
                {e.notes
                  .filter((n) => n.status === "SIGNED")
                  .map((n) => (
                    <SignedNote key={n.id} note={n} timeZone={tz} amendAction={amendAction} slug={s} canAmend={ctx.permissions.has("emr.amend") && (n.authorId === ctx.principal.user.id || ctx.permissions.has("emr.read_all"))} />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
