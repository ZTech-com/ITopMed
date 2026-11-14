import { ConciergeBell, Printer, Receipt, UserPlus } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { PatientPicker, formatBirthDate, patientName } from "@/components/patients";
import { ServicePicker } from "@/components/service-picker";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { listDay } from "@/server/appointments/appointments";
import { requireClinic } from "@/server/auth/guards";
import { listOperationalBranches } from "@/server/clinic/context";
import { doctorsWorkingOn, listDoctors } from "@/server/clinic/doctors";
import { listServices } from "@/server/clinic/resources";
import { withAppContext } from "@/server/db";
import { searchPatients } from "@/server/patients/patients";
import { todayMoney } from "@/server/reception/desk";
import { todayIn } from "@/server/scheduling/time";
import { deskCheckInAction } from "../../../desk-actions";

/**
 * Qabulxona - the reception desk on one screen: find or register the patient,
 * tick the services (live total), take the payment or leave a debt, measure
 * height/weight/blood pressure, choose the doctor -> queue number and print.
 * Today's queue with who paid what is on the right.
 */
export default async function DeskPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; patient?: string; done?: string; doctor?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "queue.manage");
  const sp = await searchParams;
  const [t, format, money] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter()]);
  const tz = ctx.tenant.timezone;
  const today = todayIn(tz);
  const base = `/c/${ctx.tenant.slug}`;
  const canBill = ctx.permissions.has("billing.invoice");
  const canPay = ctx.permissions.has("billing.payment");
  const canMeasure = ctx.permissions.has("vitals.write");
  const db = { tenantId: ctx.tenant.id, userId: ctx.principal.user.id };

  const [branches, doctors, working, services, day] = await Promise.all([
    listOperationalBranches(ctx),
    listDoctors(ctx),
    doctorsWorkingOn(ctx, today),
    canBill ? listServices(ctx) : Promise.resolve([]),
    listDay(ctx, today),
  ]);
  const withProfile = doctors.filter((d) => d.profile && !d.profile.archivedAt);
  const workingIds = new Set(working.map((w) => w.profileId));
  const doctorOptions = [...withProfile].sort((a, b) => Number(workingIds.has(b.profile!.id)) - Number(workingIds.has(a.profile!.id))).map((d) => ({
    value: d.profile!.id,
    label: `${d.fullName} · ${t(`specialties.${d.profile!.specialty}` as never)}${workingIds.has(d.profile!.id) ? "" : ` (${t("clinic.desk.notToday")})`}`,
  }));
  const priced = services.filter((s) => s.priceMinor > 0n).map((s) => ({ id: s.id, name: s.name, priceMinor: s.priceMinor.toString(), currency: s.currency }));
  const unpriced = services.filter((s) => s.priceMinor === 0n).length;

  const chosen = sp.patient
    ? await withAppContext(db, (tx) => tx.patient.findFirst({ where: { id: sp.patient, status: "ACTIVE" }, select: { id: true, mrn: true, lastName: true, firstName: true, middleName: true, birthDate: true, birthYearOnly: true, phone: true, address: true } })).catch(() => null)
    : null;
  const results = !chosen && sp.q ? await searchPatients(ctx, sp.q) : null;

  const queue = day.filter((a) => a.queueNumber !== null || a.status !== "CANCELLED").sort((a, b) => (a.queueNumber ?? 999) - (b.queueNumber ?? 999) || +a.startsAt - +b.startsAt);
  const { today: paidToday, debt } = await todayMoney(ctx, [...new Set([...queue.map((a) => a.patientId), ...(chosen ? [chosen.id] : [])])]);
  const done = sp.done ? queue.find((a) => a.id === sp.done) : undefined;
  const doneInvoice = done ? await withAppContext(db, (tx) => tx.invoice.findUnique({ where: { appointmentId: done.id }, select: { id: true } })).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("clinic.desk.title")} description={t("clinic.desk.subtitle")} />

      {done ? (
        <Card className="border-accent">
          <CardBody className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-5">
              <div className="grid size-20 shrink-0 place-items-center rounded-[18px] bg-accent-solid text-on-accent">
                <span className="text-[13px] font-medium leading-none opacity-90">{t("clinic.desk.number")}</span>
                <span className="text-[34px] font-bold leading-none tabular-nums">{done.queueNumber ?? "—"}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[18px] font-semibold">{patientName(done.patient)}</p>
                <p className="text-[14px] text-text-2">
                  {t("clinic.desk.toDoctor", { name: done.doctor.membership.user.fullName })}
                  {done.room ? ` · ${done.room.name}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`${base}/desk/ticket/${done.id}?print=1`} target="_blank" className={buttonClass("secondary", "md")}>
                <Printer aria-hidden className="size-4" /> {t("clinic.desk.printTicket")}
              </Link>
              {doneInvoice ? (
                <Link href={`${base}/billing/${doneInvoice.id}/receipt?w=80&print=1`} target="_blank" className={buttonClass("secondary", "md")}>
                  <Receipt aria-hidden className="size-4" /> {t("clinic.desk.printReceipt")}
                </Link>
              ) : null}
              <ButtonLink href={`${base}/desk`}>
                <UserPlus aria-hidden className="size-4" /> {t("clinic.desk.next")}
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
        {!chosen ? (
          <Card>
            <CardHeader title={t("clinic.desk.step1")} description={t("clinic.desk.searchHint")} />
            <CardBody>
              <PatientPicker results={results} q={sp.q ?? ""} keep={{}} baseHref={`${base}/desk`} />
            </CardBody>
          </Card>
        ) : null}
        <Form action={deskCheckInAction} className="space-y-6">
          <input type="hidden" name="$slug" value={ctx.tenant.slug} />

          <Card>
            <CardHeader title={chosen ? t("clinic.desk.step1") : t("clinic.desk.newPatient")} />
            <CardBody className="space-y-4">
              {chosen ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-soft px-4 py-3">
                  <input type="hidden" name="patientId" value={chosen.id} />
                  <div className="min-w-0">
                    <p className="font-semibold">{patientName(chosen)}</p>
                    <p className="text-[13px] text-text-2">
                      {chosen.mrn} · {await formatBirthDate(chosen.birthDate, chosen.birthYearOnly)}
                      {chosen.phone ? ` · ${chosen.phone}` : ""}
                      {chosen.address ? ` · ${chosen.address}` : ""}
                    </p>
                    {(debt.get(chosen.id) ?? 0n) > 0n ? <p className="mt-1 text-[13px] font-semibold text-danger">{t("clinic.desk.hasDebt", { amount: money(debt.get(chosen.id)!, ctx.tenant.currency) })}</p> : null}
                  </div>
                  <Link href={`${base}/desk`} className={buttonClass("ghost", "sm")}>
                    {t("clinic.desk.otherPatient")}
                  </Link>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField name="lastName" label={t("clinic.patients.lastName")} autoComplete="off" />
                    <TextField name="firstName" label={t("clinic.patients.firstName")} autoComplete="off" />
                    <TextField name="middleName" label={t("clinic.patients.middleName")} autoComplete="off" optionalLabel={t("common.optional")} />
                    <TextField name="birthDate" label={t("clinic.desk.birth")} hint={t("clinic.desk.birthHint")} placeholder="1947" inputMode="numeric" autoComplete="off" />
                    <SelectField name="sex" label={t("clinic.patients.sex")} defaultValue="UNKNOWN" options={(["FEMALE", "MALE", "UNKNOWN"] as const).map((s) => ({ value: s, label: t(`sex.${s}`) }))} />
                    <TextField name="phone" type="tel" label={t("clinic.patients.phone")} inputMode="tel" placeholder="+998" autoComplete="off" optionalLabel={t("common.optional")} />
                    <TextField name="address" label={t("clinic.patients.address")} autoComplete="off" optionalLabel={t("common.optional")} className="sm:col-span-3" />
                  </div>
                  <label className="flex items-start gap-2 text-[13px] text-text-2">
                    <input type="checkbox" name="confirmNotDuplicate" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                    <span>{t("clinic.desk.confirmNew")}</span>
                  </label>
                </>
              )}
            </CardBody>
          </Card>

          {canBill ? (
            <Card>
              <CardHeader
                title={t("clinic.desk.step2")}
                action={ctx.permissions.has("services.manage") ? <ButtonLink href={`${base}/services`} variant="ghost" size="sm">{t("clinic.desk.editPrices")}</ButtonLink> : undefined}
              />
              <CardBody className="space-y-3">
                {priced.length ? <ServicePicker services={priced} withPayment={canPay} /> : <Alert tone="warning">{t("clinic.desk.noPrices")}</Alert>}
                {unpriced > 0 ? <p className="text-[12.5px] text-text-3">{t("clinic.desk.unpriced", { count: unpriced })}</p> : null}
              </CardBody>
            </Card>
          ) : null}

          {canMeasure ? (
            <Card>
              <CardHeader title={t("clinic.desk.step3")} description={t("clinic.desk.step3Hint")} />
              <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <TextField name="HEIGHT" label={t("clinic.desk.height")} inputMode="decimal" placeholder="170" />
                <TextField name="WEIGHT" label={t("clinic.desk.weight")} inputMode="decimal" placeholder="75" />
                <TextField name="SYSTOLIC_BP" label={t("clinic.desk.systolic")} inputMode="numeric" placeholder="120" />
                <TextField name="DIASTOLIC_BP" label={t("clinic.desk.diastolic")} inputMode="numeric" placeholder="80" />
                <TextField name="HEART_RATE" label={t("clinic.desk.pulse")} inputMode="numeric" placeholder="72" />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t("clinic.desk.step4")} />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {doctorOptions.length ? (
                <SelectField name="doctorProfileId" label={t("clinic.desk.doctor")} options={doctorOptions} defaultValue={sp.doctor ?? doctorOptions[0]!.value} />
              ) : (
                <Alert tone="warning">{t("clinic.desk.noDoctors")}</Alert>
              )}
              {branches.length > 1 ? (
                <SelectField name="branchId" label={t("clinic.booking.branch")} options={branches.map((b) => ({ value: b.id, label: b.name }))} defaultValue={branches.find((b) => b.isMain)?.id ?? branches[0]!.id} />
              ) : branches[0] ? (
                <input type="hidden" name="branchId" value={branches[0].id} />
              ) : null}
              <TextField name="adminNote" label={t("clinic.desk.note")} optionalLabel={t("common.optional")} className="sm:col-span-2" />
            </CardBody>
          </Card>

          <SubmitButton full>{t("clinic.desk.submit")}</SubmitButton>
        </Form>
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader title={t("clinic.desk.today")} description={todayIso(format, today)} />
          {queue.length === 0 ? (
            <EmptyState icon={<ConciergeBell className="size-6" />} title={t("clinic.desk.emptyToday")} />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto" tabIndex={0} aria-label={t("clinic.desk.today")}>
              {queue.map((a) => {
                const m = paidToday.get(a.patientId);
                const owes = debt.get(a.patientId) ?? 0n;
                return (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[14px] font-bold tabular-nums">{a.queueNumber ?? "·"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{patientName(a.patient)}</p>
                      <p className="truncate text-[12.5px] text-text-2">{a.doctor.membership.user.fullName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                        {m ? <Badge tone={m.paidMinor >= m.totalMinor ? "success" : "warning"}>{money(m.paidMinor, m.currency)} / {money(m.totalMinor, m.currency)}</Badge> : null}
                        {owes > 0n ? <Badge tone="danger">{t("clinic.desk.debtShort", { amount: money(owes, ctx.tenant.currency) })}</Badge> : null}
                      </div>
                    </div>
                    <Link href={`${base}/desk/ticket/${a.id}?print=1`} target="_blank" className={buttonClass("ghost", "sm")} aria-label={t("clinic.desk.printTicket")}>
                      <Printer aria-hidden className="size-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function todayIso(format: Awaited<ReturnType<typeof getFormatter>>, day: string) {
  return format.dateTime(new Date(`${day}T12:00:00Z`), { dateStyle: "full", timeZone: "UTC" });
}
