import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SubmitButton } from "@/components/ui/form";
import { Alert, ButtonLink, Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { DomainError } from "@/server/errors";
import { availableDays, bookableDoctors } from "@/server/portal/booking";
import { requirePatient } from "@/server/portal/guards";
import { portalBookAction } from "../../../../portal-actions";

const UUID = /^[0-9a-f-]{36}$/;

/** Online booking in three steps: doctor → day and time → confirm. */
export default async function PortalBookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ doctor?: string; from?: string; slot?: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const sp = await searchParams;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const base = `/p/${p.tenant.slug}/book`;
  const tz = p.tenant.timezone;
  const doctors = await bookableDoctors(p);

  if (doctors.length === 0) {
    return (
      <div className="max-w-2xl">
        <PageHeader title={t("portal.book.title")} />
        <Alert tone="neutral">{t("portal.book.unavailable")}</Alert>
      </div>
    );
  }

  const doctorId = sp.doctor && UUID.test(sp.doctor) ? sp.doctor : null;
  if (!doctorId) {
    return (
      <div className="max-w-2xl">
        <PageHeader title={t("portal.book.title")} description={t("portal.book.chooseDoctor")} />
        <Card>
          <ul className="divide-y divide-border">
            {doctors.map((d) => (
              <li key={d.id}>
                <Link href={`${base}?doctor=${d.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-sunken sm:px-6">
                  <span className="min-w-0">
                    <span className="block font-medium">{d.fullName}</span>
                    <span className="block text-[14px] text-text-2">{t(`specialties.${d.specialty}` as never)}</span>
                  </span>
                  <span className="shrink-0 text-[14px] text-accent">{t("portal.book.choose")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  const data = await availableDays(p, doctorId, { from: sp.from }).catch((e) => {
    if (e instanceof DomainError) return null;
    throw e;
  });
  if (!data) {
    return (
      <div className="max-w-2xl">
        <PageHeader title={t("portal.book.title")} />
        <Alert tone="warning">{t("errors.doctorUnavailable")}</Alert>
        <div className="mt-4">
          <ButtonLink href={base} variant="secondary">{t("portal.book.otherDoctor")}</ButtonLink>
        </div>
      </div>
    );
  }
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const full = data.rules.activeCount >= data.rules.maxActive;
  const slot = sp.slot && data.days.some((d) => d.slots.includes(sp.slot!)) ? sp.slot : null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={t("portal.book.title")}
        description={`${data.doctor.fullName} · ${t(`specialties.${data.doctor.specialty}` as never)}`}
        action={<ButtonLink href={base} variant="secondary">{t("portal.book.otherDoctor")}</ButtonLink>}
      />
      <p className="text-[14px] text-text-2">{t("portal.book.rules", { days: data.rules.days, active: data.rules.activeCount, max: data.rules.maxActive })}</p>
      {full ? <Alert tone="warning">{t("errors.bookingTooMany")}</Alert> : null}

      {slot && !full ? (
        <Card>
          <CardHeader title={t("portal.book.confirmTitle")} />
          <CardBody className="space-y-4 text-[15px]">
            <p>
              <span className="font-semibold">{day(data.days.find((d) => d.slots.includes(slot))!.date)}</span>, {time(slot)} · {data.doctor.fullName}
            </p>
            <Form action={portalBookAction}>
              <input type="hidden" name="$slug" value={p.tenant.slug} />
              <input type="hidden" name="doctorId" value={doctorId} />
              <input type="hidden" name="startsAt" value={slot} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton>{t("portal.book.confirm")}</SubmitButton>
                <Link href={`${base}?doctor=${doctorId}${sp.from ? `&from=${sp.from}` : ""}`} className={buttonClass("ghost", "lg")}>
                  {t("common.cancel")}
                </Link>
              </div>
            </Form>
          </CardBody>
        </Card>
      ) : null}

      {data.days.length === 0 ? <Alert tone="neutral">{t("portal.book.noSlots")}</Alert> : null}
      <div className="space-y-4">
        {data.days.map((d) => (
          <Card key={d.date}>
            <CardHeader title={day(d.date)} />
            <CardBody>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {d.slots.map((s) => (
                  <Link
                    key={s}
                    href={`${base}?doctor=${doctorId}${sp.from ? `&from=${sp.from}` : ""}&slot=${encodeURIComponent(s)}`}
                    aria-current={s === slot ? "true" : undefined}
                    className={buttonClass(s === slot ? "primary" : "secondary", "md", "tabular-nums")}
                  >
                    {time(s)}
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      {data.next ? (
        <ButtonLink href={`${base}?doctor=${doctorId}&from=${data.next}`} variant="secondary">
          {t("portal.book.later")}
        </ButtonLink>
      ) : null}
    </div>
  );
}
