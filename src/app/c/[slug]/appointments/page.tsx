import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { PatientPicker, formatBirthDate, patientName } from "@/components/patients";
import { Form, SelectField, TextField } from "@/components/ui/form";
import { Alert, Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { doctorSlots, listDoctors } from "@/server/clinic/doctors";
import { listServices } from "@/server/clinic/resources";
import { withAppContext } from "@/server/db";
import { searchPatients } from "@/server/patients/patients";
import { isLocalDate, todayIn } from "@/server/scheduling/time";
import { bookAction } from "../../../care-actions";

const UUID = /^[0-9a-f-]{36}$/;

/** Booking wizard driven by the URL (?patient=&doctor=&date=&service=), so every step is linkable and works without JS. */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "appointments.manage");
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const tz = ctx.tenant.timezone;
  const base = `/c/${ctx.tenant.slug}/appointments`;
  const date = isLocalDate(sp.date) && sp.date >= todayIn(tz) ? sp.date : todayIn(tz);
  const patientId = sp.patient && UUID.test(sp.patient) ? sp.patient : undefined;
  const doctorId = sp.doctor && UUID.test(sp.doctor) ? sp.doctor : undefined;
  const serviceId = sp.service && UUID.test(sp.service) ? sp.service : "";
  const q = sp.q ?? "";

  const [doctors, services] = await Promise.all([listDoctors(ctx), listServices(ctx)]);
  const bookable = doctors.filter((d) => d.profile && !d.profile.archivedAt && d.weeklyMinutes > 0);
  const patient = patientId
    ? await withAppContext({ tenantId: ctx.tenant.id, userId: ctx.principal.user.id }, (tx) =>
        tx.patient.findFirst({ where: { id: patientId, status: "ACTIVE" }, select: { id: true, mrn: true, lastName: true, firstName: true, middleName: true, birthDate: true } }),
      )
    : null;
  const results = !patient && q.trim().length >= 2 ? await searchPatients(ctx, q) : null;
  const doctor = bookable.find((d) => d.profile!.id === doctorId);
  const slots = doctor ? await doctorSlots(ctx, doctor.profile!.id, date) : [];
  const keep = { doctor: doctorId, date, service: serviceId || undefined };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader title={t("clinic.booking.title")} description={t("clinic.booking.subtitle")} />

      <Card>
        <CardHeader title={t("clinic.booking.patient")} />
        <CardBody>
          {patient ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{patientName(patient)}</p>
                <p className="text-[13px] text-text-3">
                  {patient.mrn} · {await formatBirthDate(patient.birthDate)}
                </p>
              </div>
              <Link href={`${base}?${new URLSearchParams(Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`} className={buttonClass("ghost", "sm")}>
                {t("clinic.booking.change")}
              </Link>
            </div>
          ) : (
            <PatientPicker results={results} q={q} keep={keep} baseHref={base} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("clinic.booking.doctor")} />
        <CardBody>
          <form method="get" className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
            {patientId ? <input type="hidden" name="patient" value={patientId} /> : null}
            <label>
              <span className="mb-1.5 block text-[13px] font-medium">{t("clinic.booking.doctor")}</span>
              <select name="doctor" defaultValue={doctorId ?? ""} className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px]">
                <option value="">{t("clinic.booking.chooseDoctor")}</option>
                {bookable.map((d) => (
                  <option key={d.profile!.id} value={d.profile!.id}>
                    {d.fullName} — {t(`specialties.${d.profile!.specialty}` as never)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1.5 block text-[13px] font-medium">{t("clinic.booking.date")}</span>
              <input type="date" name="date" defaultValue={date} min={todayIn(tz)} className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px]" />
            </label>
            <label>
              <span className="mb-1.5 block text-[13px] font-medium">{t("clinic.booking.service")}</span>
              <select name="service" defaultValue={serviceId} className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px]">
                <option value="">{t("clinic.booking.anyService")}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {t("clinic.services.minutes", { count: s.durationMinutes })}
                  </option>
                ))}
              </select>
            </label>
            <button className={buttonClass("secondary", "lg")}>{t("clinic.booking.show")}</button>
          </form>
        </CardBody>
      </Card>

      {doctor ? (
        <Card>
          <CardHeader title={t("clinic.booking.slots")} description={`${doctor.fullName} · ${format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "full", timeZone: "UTC" })}`} />
          <CardBody>
            {!patient ? <div className="mb-4"><Alert tone="warning">{t("clinic.booking.needPatient")}</Alert></div> : null}
            {slots.length === 0 ? (
              <p className="text-[14px] text-text-2">{t("clinic.booking.noSlots")}</p>
            ) : (
              <Form action={bookAction}>
                <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                <input type="hidden" name="patientId" value={patient?.id ?? ""} />
                <input type="hidden" name="doctorProfileId" value={doctor.profile!.id} />
                <input type="hidden" name="serviceId" value={serviceId} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField name="source" label={t("clinic.booking.source")} options={(["FRONT_DESK", "PHONE"] as const).map((s) => ({ value: s, label: t(`apptSource.${s}`) }))} />
                  <TextField name="adminNote" label={t("clinic.booking.adminNote")} hint={t("clinic.booking.adminNoteHint")} optionalLabel={t("common.optional")} />
                </div>
                <fieldset disabled={!patient}>
                  <legend className="mb-2 text-[13px] font-medium">{t("clinic.booking.slots")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((s) => (
                      <button key={s.start.toISOString()} name="startsAt" value={s.start.toISOString()} className="h-10 min-w-20 rounded-[10px] border border-border-strong bg-surface px-3 text-[14px] font-medium tabular-nums hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50">
                        {format.dateTime(s.start, { timeStyle: "short", timeZone: tz })}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </Form>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
