import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AllergyBanner, AllergyForm, DiagnosisList, SignedNote, VitalsForm, VitalsTable } from "@/components/clinical";
import { formatBirthDate, patientName } from "@/components/patients";
import { Form, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { NOTE_SECTIONS, amendmentHash, getEncounter, noteHash } from "@/server/emr/record";
import { requestMeta } from "@/server/http";
import { DomainError } from "@/server/tenancy/provisioning";
import { allergyAction, amendAction, clinicalStatusAction, diagnosisAction, finishVisitAction, noteAction, vitalsAction } from "../../../../care-actions";
import { labOrderAction } from "../../../../lab-actions";
import { LabResultsList } from "@/components/lab";
import { listLabTests } from "@/server/lab/lab";

/** The doctor's visit workspace. Every load is an audited record access. */
export default async function EncounterPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "emr.read");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const data = await getEncounter(ctx, id, await requestMeta()).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const { encounter: e, allergies, labOrders, isOwn } = data;
  const labTests = ctx.permissions.has("orders.create") ? (await listLabTests(ctx)).filter((x) => x.labAnalytes.length > 0) : [];
  const tz = ctx.tenant.timezone;
  const open = e.status === "OPEN";
  const canWrite = isOwn && open && ctx.permissions.has("emr.write");
  const authors = new Map([[ctx.principal.user.id, ctx.principal.user.fullName]]);
  const s = ctx.tenant.slug;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={`${t("clinic.visit.encounter")} · ${format.dateTime(e.startedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })}`}
        title={patientName(e.patient)}
        description={`${e.patient.mrn} · ${await formatBirthDate(e.patient.birthDate)} · ${t(`sex.${e.patient.sex}`)}`}
        action={
          <>
            <Badge tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Badge>
            <ButtonLink href={`/c/${s}/patients/${e.patient.id}/record`} variant="secondary" size="sm">{t("clinic.record.title")}</ButtonLink>
          </>
        }
      />
      <AllergyBanner allergies={allergies} />
      {!open ? <Alert tone="neutral">{t("clinic.visit.closed")}</Alert> : null}

      <Card>
        <CardHeader title={t("clinic.visit.note")} description={canWrite ? t("clinic.visit.signHint") : undefined} />
        <CardBody className="space-y-6">
          {e.notes.map((n) =>
            n.status === "SIGNED" ? (
              <SignedNote
                key={n.id}
                note={{
                  ...n,
                  authorName: authors.get(n.authorId) ?? "—",
                  integrityOk: Boolean(n.contentHash && n.signedAt && n.signedById && n.contentHash === noteHash({ ...n, signedAt: n.signedAt, signedById: n.signedById })),
                  amendments: n.amendments.map((a) => ({ ...a, authorName: authors.get(a.authorId) ?? "—", integrityOk: a.contentHash === amendmentHash(a) })),
                }}
                timeZone={tz}
                amendAction={amendAction}
                slug={s}
                canAmend={n.authorId === ctx.principal.user.id && ctx.permissions.has("emr.amend")}
              />
            ) : n.authorId === ctx.principal.user.id && canWrite ? (
              <Form key={n.id} action={noteAction}>
                <input type="hidden" name="$slug" value={s} />
                <input type="hidden" name="noteId" value={n.id} />
                <input type="hidden" name="encounterId" value={e.id} />
                {NOTE_SECTIONS.map((sec) => (
                  <TextAreaField key={sec} name={sec} label={t(`noteSection.${sec}`)} defaultValue={n[sec]} rows={sec === "examination" || sec === "plan" ? 4 : 3} />
                ))}
                <div className="flex flex-wrap justify-end gap-2">
                  <button name="op" value="draft" className={buttonClass("secondary", "lg")}>{t("clinic.visit.saveDraft")}</button>
                  <button name="op" value="sign" className={buttonClass("primary", "lg")}>{t("clinic.visit.sign")}</button>
                </div>
              </Form>
            ) : (
              <p key={n.id} className="text-[14px] text-text-2">{t("status.DRAFT")}</p>
            ),
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("clinic.visit.diagnoses")} />
          <CardBody className="space-y-4">
            <DiagnosisList diagnoses={e.diagnoses} statusAction={clinicalStatusAction} slug={s} canEdit={canWrite} />
            {canWrite ? (
              <Form action={diagnosisAction} className="border-t border-border pt-4">
                <input type="hidden" name="$slug" value={s} />
                <input type="hidden" name="encounterId" value={e.id} />
                <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                  <TextField name="icd10Code" label={t("clinic.visit.icd10")} hint={t("clinic.visit.icd10Hint")} required />
                  <TextField name="description" label={t("clinic.visit.description")} required />
                </div>
                <SelectField name="kind" label={t("clinic.visit.kind")} options={(["PRIMARY", "SECONDARY"] as const).map((k) => ({ value: k, label: t(`diagnosisKind.${k}`) }))} />
                <SubmitButton variant="secondary">{t("clinic.visit.addDiagnosis")}</SubmitButton>
              </Form>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("clinic.visit.vitals")} />
          <CardBody className="space-y-4">
            <VitalsTable vitals={e.vitals} timeZone={tz} />
            {open && ctx.permissions.has("vitals.write") ? (
              <div className="border-t border-border pt-4">
                <VitalsForm action={vitalsAction} slug={s} patientId={e.patient.id} encounterId={e.id} />
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("clinic.labOrder.title")} />
        <CardBody className="space-y-4">
          <LabResultsList orders={labOrders} timeZone={tz} />
          {canWrite && ctx.permissions.has("orders.create") ? (
            labTests.length === 0 ? (
              <p className="text-[13px] text-text-3">{t("clinic.labOrder.noLabTests")}</p>
            ) : (
              <Form action={labOrderAction} className="border-t border-border pt-4">
                <input type="hidden" name="$slug" value={s} />
                <input type="hidden" name="encounterId" value={e.id} />
                <fieldset>
                  <legend className="text-[13px] font-medium">{t("clinic.labOrder.chooseTests")}</legend>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {labTests.map((x) => (
                      <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                        <input type="checkbox" name="serviceIds" value={x.id} className="size-4 accent-[var(--accent)]" />
                        {x.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <SelectField name="priority" label={t("clinic.lab.priority")} options={(["ROUTINE", "URGENT"] as const).map((p) => ({ value: p, label: t(`priority.${p}`) }))} />
                  <TextField name="indication" label={t("clinic.lab.indication")} optionalLabel={t("common.optional")} />
                </div>
                <SubmitButton variant="secondary">{t("clinic.labOrder.order")}</SubmitButton>
              </Form>
            )
          ) : null}
        </CardBody>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader title={t("clinic.visit.addAllergy")} />
          <CardBody>
            <AllergyForm action={allergyAction} slug={s} patientId={e.patient.id} />
          </CardBody>
        </Card>
      ) : null}

      {canWrite ? (
        <Form action={finishVisitAction} className="flex flex-wrap items-center justify-end gap-3">
          <input type="hidden" name="$slug" value={s} />
          <input type="hidden" name="encounterId" value={e.id} />
          <p className="text-[13px] text-text-3">{t("clinic.visit.finishHint")}</p>
          <SubmitButton>{t("clinic.visit.finish")}</SubmitButton>
        </Form>
      ) : null}
    </div>
  );
}
