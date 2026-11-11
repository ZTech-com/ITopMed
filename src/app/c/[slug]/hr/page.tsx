import { BadgeAlert, Palmtree, Users } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { roleLabel } from "@/lib/role-label";
import { Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listStaffHr } from "@/server/hr/hr";

export default async function HrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "hr.read");
  const [t, format, staff] = await Promise.all([getTranslations(), getFormatter(), listStaffHr(ctx)]);
  const base = `/c/${ctx.tenant.slug}/hr`;
  const d = (x: Date) => format.dateTime(x, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="space-y-6">
      <PageHeader title={t("clinic.hr.title")} description={t("clinic.hr.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("clinic.hr.people")} value={staff.length} icon={<Users aria-hidden className="size-4" />} />
        <Stat label={t("clinic.hr.credentialAlerts")} value={staff.filter((s) => s.expiredCredentials + s.expiringCredentials > 0).length} icon={<BadgeAlert aria-hidden className="size-4" />} />
        <Stat label={t("clinic.hr.onLeaveToday")} value={staff.filter((s) => s.onLeaveNow).length} icon={<Palmtree aria-hidden className="size-4" />} />
      </div>
      <Card>
        <Table caption={t("clinic.hr.title")}>
          <thead>
            <tr>
              <Th>{t("clinic.hr.person")}</Th>
              <Th>{t("clinic.hr.position")}</Th>
              <Th>{t("clinic.hr.credentials")}</Th>
              <Th>{t("clinic.hr.leave")}</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((m) => (
              <tr key={m.id} className="hover:bg-sunken">
                <Td>
                  <Link href={`${base}/${m.id}`} className="font-medium hover:underline">
                    {m.user.fullName}
                  </Link>
                  <p className="text-[12.5px] text-text-3">{m.roles.map((r) => roleLabel(t as never, r.role.key, r.role.name)).join(", ")}</p>
                </Td>
                <Td className="text-text-2">
                  {m.staffProfile?.position ?? "—"}
                  {m.staffProfile?.department ? <p className="text-[12.5px] text-text-3">{m.staffProfile.department.name}</p> : null}
                </Td>
                <Td>
                  {m.expiredCredentials > 0 ? (
                    <Badge tone="danger">{t("clinic.hr.expiredCount", { count: m.expiredCredentials })}</Badge>
                  ) : m.expiringCredentials > 0 ? (
                    <Badge tone="warning">{t("clinic.hr.expiringCount", { count: m.expiringCredentials })}</Badge>
                  ) : m.credentials.length > 0 ? (
                    <Badge tone="success">{t("clinic.hr.credentialsOk")}</Badge>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </Td>
                <Td>
                  {m.onLeaveNow && m.nextLeave ? (
                    <Badge tone="warning">{t("clinic.hr.onLeaveUntil", { date: d(m.nextLeave.endsOn) })}</Badge>
                  ) : m.nextLeave ? (
                    <span className="text-[13px] text-text-2">{t("clinic.hr.leaveFrom", { date: d(m.nextLeave.startsOn) })}</span>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
