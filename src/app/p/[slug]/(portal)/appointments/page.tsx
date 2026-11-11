import { getTranslations } from "next-intl/server";
import { AppointmentItem } from "@/components/portal";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { listMyAppointments } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";
import { portalCancelAction } from "../../../../portal-actions";

export default async function PortalAppointmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const [t, list] = await Promise.all([getTranslations(), listMyAppointments(p)]);
  const tz = p.tenant.timezone;
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("portal.appointments.title")} description={t("portal.appointments.subtitle")} />
      <Card>
        <CardHeader title={t("portal.appointments.upcoming")} description={t("portal.appointments.cancelRule")} />
        {list.upcoming.length === 0 ? (
          <p className="px-5 py-5 text-[14px] text-text-2 sm:px-6">{t("portal.appointments.noneUpcoming")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.upcoming.map((a) => (
              <AppointmentItem key={a.id} a={a} timeZone={tz} slug={p.tenant.slug} cancelAction={portalCancelAction} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("portal.appointments.past")} />
        {list.past.length === 0 ? (
          <p className="px-5 py-5 text-[14px] text-text-2 sm:px-6">{t("portal.appointments.nonePast")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.past.map((a) => (
              <AppointmentItem key={a.id} a={{ ...a, canCancel: false }} timeZone={tz} slug={p.tenant.slug} />
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[13px] text-text-3">{t("portal.appointments.bookingNote")}</p>
    </div>
  );
}
