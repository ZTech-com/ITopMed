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
import { allergyAction, amendAction, applyNoteTemplateAction, cancelPrescriptionAction, clinicalStatusAction, diagnosisAction, finishVisitAction, noteAction, prescriptionAction, vitalsAction } from "../../../../care-actions";
import { labOrderAction } from "../../../../lab-actions";
import { labReleaseAction } from "../../../../portal-actions";
import { LabResultsList } from "@/components/lab";
import { DentalChart, DentalHistory, ToothForm } from "@/components/dental";
import { toothAction } from "../../../../dental-actions";
import { listLabTests } from "@/server/lab/lab";
import { listTemplates } from "@/server/clinic/templates";
import { listServices } from "@/server/clinic/resources";
import { todayMoney } from "@/server/reception/desk";
import { moneyFormatter } from "@/components/money";
import { ServicePicker } from "@/components/service-picker";
import { extraServicesAction } from "../../../../desk-actions";

/** The doctor's visit workspace. Every load is an audited record access. */
export default async function EncounterPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ tooth?: string; dentition?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireClinic(slug, "emr.read");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const data = await getEncounter(ctx, id, await requestMeta()).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const { encounter: e, allergies, labOrders, dental, isOwn } = data;
  const labTests = ctx.permissions.has("orders.create") ? (await listLabTests(ctx)).filter((x) => x.labAnalytes.length > 0) : [];
  const tz = ctx.tenant.timezone;
  const open = e.status === "OPEN";
  const canWrite = isOwn && open && ctx.permissions.has("emr.write");
  const canPrescribe = isOwn && open && ctx.permissions.has("prescriptions.write");
  const templates = await listTemplates(ctx);
  const noteTemplates = templates.filter((x) => x.kind === "NOTE");
  const docTemplates = templates.filter((x) => x.kind === "DOCUMENT");
  const hasDraft = e.notes.some((n) => n.status === "DRAFT" && n.authorId === ctx.principal.user.id);
  const authors = new Map([[ctx.principal.user.id, ctx.principal.user.fullName]]);
  const s = ctx.tenant.slug;
  const canBill = ctx.permissions.has("billing.invoice");
  const [priced, money, billing] = await Promise.all([
    canBill ? listServices(ctx).then((l) => l.filter((x) => x.priceMinor > 0n).map((x) => ({ id: x.id, name: x.name, priceMinor: x.priceMinor.toString(), currency: x.currency }))) : Promise.resolve([]),
    moneyFormatter(),
    todayMoney(ctx, [e.patient.id]),
  ]);
  const paidToday = billing.today.get(e.patient.id);
  const owes = billing.debt.get(e.patient.id) ?? 0n;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={`${t("clinic.visit.encounter")} · ${format.dateTime(e.startedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz })}`}
        title={patientName(e.patient)}
        description={`${e.patient.mrn} · ${await formatBirthDate(e.patient.birthDate, e.patient.birthYearOnly)} · ${t(`sex.${e.patient.sex}`)}${e.patient.address ? ` · ${e.patient.address}` : ""}`}
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
          {canWrite && hasDraft && noteTemplates.length > 0 ? (
            <Form action={applyNoteTemplateAction} className="space-y-0">
              <input type="hidden" name="$slug" value={s} />
              <input type="hidden" name="encounterId" value={e.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 sm:max-w-sm">
                  <SelectField name="templateId" label={t("templates.applyLabel")} options={noteTemplates.map((x) => ({ value: x.id, label: x.specialty ? `${x.name} · ${t(`specialties.${x.specialty}` as never)}` : x.name }))} />
                </div>
                <SubmitButton variant="secondary">{t("templates.apply")}</SubmitButton>
              </div>
              <p className="mt-1 text-[12.5px] text-text-3">{t("templates.applyHint")}</p>
            </Form>
          ) : null}
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
                  <TextField name="icd10Code" label={t("clinic.visit.icd10")} hint={t("clinic.visit.icd10Optional")} optionalLabel={t("common.optional")} />
                  <TextAreaField name="description" label={t("clinic.visit.description")} rows={2} />
                </div>
                <SelectField name="kind" label={t("clinic.visit.kind")} options={(["PRIMARY", "SECONDARY", "COMPLICATION"] as const).map((k) => ({ value: k, label: t(`diagnosisKind.${k}`) }))} />
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

      {dental ? (
        <Card id="dental">
          <CardHeader title={t("dental.title")} description={canWrite ? t("dental.hint") : undefined} />
          <CardBody className="space-y-5">
            <DentalChart
              current={dental.current}
              dentition={sp.dentition === "primary" ? "primary" : "permanent"}
              toothHref={canWrite ? (n) => `?tooth=${n}${sp.dentition === "primary" ? "&dentition=primary" : ""}#dental` : undefined}
              selected={Number(sp.tooth) || undefined}
              switchHref={`?dentition=${sp.dentition === "primary" ? "permanent" : "primary"}#dental`}
            />
            {canWrite ? <ToothForm action={toothAction} slug={s} encounterId={e.id} tooth={Number(sp.tooth) || undefined} /> : null}
            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-accent">{t("dental.history")}</summary>
              <div className="mt-2">
                <DentalHistory history={dental.history} timeZone={tz} />
              </div>
            </details>
          </CardBody>
        </Card>
      ) : null}
      {docTemplates.length > 0 ? (
        <Card id="documents">
          <CardHeader title={t("templates.printTitle")} description={t("templates.printHint")} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {docTemplates.map((d) => (
                <ButtonLink key={d.id} href={`/c/${s}/encounters/${e.id}/document/${d.id}`} variant="secondary" size="sm">
                  {d.name}
                </ButtonLink>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {canBill || paidToday || owes > 0n ? (
        <Card id="services">
          <CardHeader title={t("clinic.desk.visitServices")} description={canBill ? t("clinic.desk.visitServicesHint") : undefined} />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {paidToday ? (
                <>
                  <span className="text-[14px] text-text-2">{paidToday.services.join(", ")}</span>
                  <Badge tone={paidToday.paidMinor >= paidToday.totalMinor ? "success" : "warning"}>{t("clinic.desk.paidOf", { paid: money(paidToday.paidMinor, paidToday.currency), total: money(paidToday.totalMinor, paidToday.currency) })}</Badge>
                </>
              ) : (
                <span className="text-[14px] text-text-2">{t("clinic.desk.noServicesToday")}</span>
              )}
              {owes > 0n ? <Badge tone="danger">{t("clinic.desk.debtShort", { amount: money(owes, ctx.tenant.currency) })}</Badge> : null}
            </div>
            {canBill && priced.length ? (
              <Form action={extraServicesAction} className="border-t border-border pt-4">
                <input type="hidden" name="$slug" value={s} />
                <input type="hidden" name="$back" value={`/c/${s}/encounters/${e.id}`} />
                <input type="hidden" name="patientId" value={e.patient.id} />
                <input type="hidden" name="branchId" value={e.branchId} />
                {e.appointmentId ? <input type="hidden" name="appointmentId" value={e.appointmentId} /> : null}
                <ServicePicker services={priced} withPayment={ctx.permissions.has("billing.payment")} />
                <SubmitButton>{t("clinic.desk.addExtra")}</SubmitButton>
              </Form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card id="prescriptions">
        <CardHeader
          title={t("clinic.rx.title")}
          description={canPrescribe ? t("clinic.rx.hint") : undefined}
          action={
            e.prescriptions.some((p) => p.status === "ACTIVE") ? (
              <ButtonLink href={`/c/${s}/encounters/${e.id}/prescription`} variant="secondary" size="sm">
                {t("clinic.rx.print")}
              </ButtonLink>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          {e.prescriptions.length === 0 ? <p className="text-[14px] text-text-2">{t("clinic.rx.none")}</p> : null}
          <ul className="space-y-3">
            {e.prescriptions.map((p) => (
              <li key={p.id} className={p.status === "CANCELLED" ? "text-[14px] text-text-3 line-through" : "text-[14px]"}>
                <p className="font-medium">
                  {p.drug}
                  {p.allergyOverride ? (
                    <span className="ml-2 inline-block align-middle">
                      <Badge tone="danger">{t("clinic.rx.allergyOverride")}</Badge>
                    </span>
                  ) : null}
                  {p.status === "CANCELLED" ? <span className="ml-2 no-underline">({t("clinic.rx.cancelledLabel")})</span> : null}
                </p>
                <p className="text-text-2">
                  {[p.dose, p.frequency, p.route, p.durationDays ? t("clinic.rx.days", { count: p.durationDays }) : null].filter(Boolean).join(" · ")}
                </p>
                {p.instructions ? <p className="text-text-2">{p.instructions}</p> : null}
                {p.status === "ACTIVE" && p.prescribedById === ctx.principal.user.id && ctx.permissions.has("prescriptions.write") ? (
                  <Form action={cancelPrescriptionAction} className="mt-1 space-y-0">
                    <input type="hidden" name="$slug" value={s} />
                    <input type="hidden" name="encounterId" value={e.id} />
                    <input type="hidden" name="prescriptionId" value={p.id} />
                    <button className="min-h-8 text-[13px] text-text-3 hover:text-danger">{t("clinic.rx.cancel")}</button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
          {canPrescribe ? (
            <Form action={prescriptionAction} className="border-t border-border pt-4">
              <input type="hidden" name="$slug" value={s} />
              <input type="hidden" name="encounterId" value={e.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="drug" label={t("clinic.rx.drug")} hint={t("clinic.rx.drugHint")} required />
                <TextField name="dose" label={t("clinic.rx.dose")} placeholder={t("clinic.rx.dosePlaceholder")} required />
                <TextField name="frequency" label={t("clinic.rx.frequency")} placeholder={t("clinic.rx.frequencyPlaceholder")} required />
                <TextField name="route" label={t("clinic.rx.route")} placeholder={t("clinic.rx.routePlaceholder")} optionalLabel={t("common.optional")} />
                <TextField name="durationDays" label={t("clinic.rx.duration")} inputMode="numeric" optionalLabel={t("common.optional")} />
              </div>
              <TextAreaField name="instructions" label={t("clinic.rx.instructions")} rows={2} optionalLabel={t("common.optional")} />
              {allergies.length > 0 ? (
                <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-sunken p-3 text-[14px]">
                  <p>{t("clinic.rx.allergyCheck", { list: allergies.map((a) => a.substance).join(", ") })}</p>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="allergyOverride" className="mt-0.5 size-4 accent-[var(--accent)]" />
                    <span>{t("clinic.rx.allergyConfirm")}</span>
                  </label>
                </div>
              ) : null}
              <SubmitButton variant="secondary">{t("clinic.rx.add")}</SubmitButton>
            </Form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("clinic.labOrder.title")} />
        <CardBody className="space-y-4">
          <LabResultsList orders={labOrders} timeZone={tz} release={isOwn && ctx.permissions.has("emr.write") && ctx.modules.has("patient_portal") ? { slug: s, action: labReleaseAction } : undefined} />
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
