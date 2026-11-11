import { CalendarDays, FlaskConical, Receipt } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { AppointmentItem } from "@/components/portal";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { portalOverview } from "@/server/portal/data";
import { requirePatient } from "@/server/portal/guards";
import { portalCancelAction } from "../../../portal-actions";

export default async function PortalHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePatient(slug);
  const [t, format, money, o] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), portalOverview(p)]);
  const base = `/p/${p.tenant.slug}`;
  const tz = p.tenant.timezone;
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader eyebrow={p.tenant.name} title={t("portal.home.greeting", { name: p.patient.firstName })} description={t("portal.home.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("portal.home.nextVisit")} value={o.next[0] ? format.dateTime(o.next[0].startsAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—"} icon={<CalendarDays aria-hidden className="size-4" />} />
        <Stat label={t("portal.home.results")} value={o.resultCount} icon={<FlaskConical aria-hidden className="size-4" />} />
        <Stat label={t("portal.home.balanceDue")} value={money(o.balanceDueMinor, p.tenant.currency)} hint={o.dueCount > 0 ? t("portal.home.unpaid", { count: o.dueCount }) : undefined} icon={<Receipt aria-hidden className="size-4" />} />
      </div>

      <Card>
        <CardHeader
          title={t("portal.home.upcoming")}
          action={
            <Link href={`${base}/appointments`} className="text-[14px] font-medium text-accent hover:underline">
              {t("portal.home.all")}
            </Link>
          }
        />
        {o.next.length === 0 ? (
          <p className="px-5 py-5 text-[14px] text-text-2 sm:px-6">{t("portal.appointments.noneUpcoming")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {o.next.map((a) => (
              <AppointmentItem key={a.id} a={a} timeZone={tz} slug={p.tenant.slug} cancelAction={portalCancelAction} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("portal.home.latestResults")}
          action={
            <Link href={`${base}/results`} className="text-[14px] font-medium text-accent hover:underline">
              {t("portal.home.all")}
            </Link>
          }
        />
        {o.results.length === 0 ? (
          <p className="px-5 py-5 text-[14px] text-text-2 sm:px-6">{t("portal.results.none")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {o.results.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/results/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-sunken sm:px-6">
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{r.items.map((i) => i.name).join(", ")}</span>
                    <span className="block text-[13px] text-text-3">{format.dateTime(r.releasedAt ?? r.orderedAt, { dateStyle: "medium", timeZone: tz })}</span>
                  </span>
                  {r.items.some((i) => i.results.some((x) => x.flag !== "NORMAL")) ? <span className="text-[13px] font-medium text-danger">{t("portal.results.outOfRange")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
