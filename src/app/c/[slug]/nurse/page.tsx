import { HeartPulse } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { VitalsForm } from "@/components/clinical";
import { patientName } from "@/components/patients";
import { Form, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { listDay } from "@/server/appointments/appointments";
import { requireClinic } from "@/server/auth/guards";
import { labWorklist } from "@/server/lab/lab";
import { todayIn } from "@/server/scheduling/time";
import { nursingAction, vitalsAction } from "../../../care-actions";
import { listNursingRecords } from "@/server/emr/history";
import { requestMeta } from "@/server/http";
import { labStepAction } from "../../../lab-actions";

/** Nurse station: today's patients in the nurse's branches — vital signs and specimen collection. */
export default async function NurseStationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "vitals.write");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const tz = ctx.tenant.timezone;
  const [day, toCollect] = await Promise.all([listDay(ctx, todayIn(tz)), ctx.permissions.has("lab.collect") ? labWorklist(ctx, ["ORDERED"]) : Promise.resolve([])]);
  const waiting = day.filter((a) => a.status === "CHECKED_IN" || a.status === "IN_PROGRESS");
  const s = ctx.tenant.slug;
  const canNurse = ctx.permissions.has("nursing.write");
  const tn = await getTranslations("nursingLog");
  const meta = await requestMeta();
  const logs = new Map<string, Awaited<ReturnType<typeof listNursingRecords>>>();
  for (const a of waiting) if (!logs.has(a.patient.id)) logs.set(a.patient.id, await listNursingRecords(ctx, a.patient.id, meta, 10).catch(() => []));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title={t("clinic.nurse.title")} description={t("clinic.nurse.subtitle")} />

      {ctx.permissions.has("lab.collect") ? (
        <Card>
          <CardHeader title={t("clinic.nurse.pendingCollections")} />
          {toCollect.length === 0 ? (
            <p className="px-6 py-4 text-[14px] text-text-2">{t("clinic.nurse.noCollections")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {toCollect.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <Link href={`/c/${s}/lab/${o.id}`} className="font-medium hover:text-accent">
                      <span className="font-mono">{o.number}</span> · {patientName(o.patient)}
                    </Link>
                    <p className="text-[13px] text-text-2">{o.items.map((i) => i.name).join(", ")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.priority === "URGENT" ? <Badge tone="danger">{t("priority.URGENT")}</Badge> : null}
                    <Form action={labStepAction} className="space-y-0">
                      <input type="hidden" name="$slug" value={s} />
                      <input type="hidden" name="orderId" value={o.id} />
                      <button name="op" value="collect" className={buttonClass("primary", "sm")}>{t("clinic.lab.collect")}</button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader title={t("nav.queue")} />
        {waiting.length === 0 ? (
          <EmptyState icon={<HeartPulse className="size-6" />} title={t("clinic.nurse.empty")} />
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map((a) => (
              <li key={a.id} className="space-y-3 px-5 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.queueNumber ? <span className="mr-2 rounded-md bg-accent-soft px-1.5 text-[12px] font-semibold text-accent">#{a.queueNumber}</span> : null}
                      {patientName(a.patient)}
                    </p>
                    <p className="text-[13px] text-text-2">
                      {a.patient.mrn} · {format.dateTime(a.startsAt, { timeStyle: "short", timeZone: tz })} · {a.doctor.membership.user.fullName}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                </div>
                <details>
                  <summary className="cursor-pointer text-[14px] font-medium text-accent">{t("clinic.nurse.recordVitals")}</summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-[13px] text-text-2">{tn("bothArms")}</p>
                    <VitalsForm action={vitalsAction} slug={s} patientId={a.patient.id} />
                  </div>
                </details>
                {canNurse ? (
                  <details>
                    <summary className="cursor-pointer text-[14px] font-medium text-accent">{tn("title")}</summary>
                    <div className="mt-3 space-y-3">
                      {(logs.get(a.patient.id) ?? []).length === 0 ? (
                        <p className="text-[13px] text-text-2">{tn("none")}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {(logs.get(a.patient.id) ?? []).map((r) => (
                            <li key={r.id} className="rounded-[10px] bg-sunken px-3 py-2 text-[13.5px]">
                              <span className="font-medium">{tn(`kindV.${r.kind}` as never)}:</span> {r.text}
                              {r.drug ? <span> · {[r.drug, r.dose, r.route].filter(Boolean).join(" ")}</span> : null}
                              <span className="block text-[12px] text-text-3">{tn("by", { name: r.recordedByName, time: format.dateTime(r.recordedAt, { dateStyle: "short", timeStyle: "short", timeZone: tz }) })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Form action={nursingAction}>
                        <input type="hidden" name="$slug" value={s} />
                        <input type="hidden" name="patientId" value={a.patient.id} />
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <div className="grid gap-3 sm:grid-cols-4">
                          <SelectField name="kind" label={tn("kind")} options={(["FIRST_AID", "MEDICATION", "NOTE"] as const).map((k) => ({ value: k, label: tn(`kindV.${k}`) }))} />
                          <TextField name="drug" label={tn("drug")} optionalLabel={t("common.optional")} />
                          <TextField name="dose" label={tn("dose")} optionalLabel={t("common.optional")} />
                          <TextField name="route" label={tn("route")} optionalLabel={t("common.optional")} />
                        </div>
                        <TextAreaField name="text" label={tn("text")} rows={2} />
                        <SubmitButton variant="secondary">{tn("save")}</SubmitButton>
                      </Form>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
