import { UserRound } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listDoctors } from "@/server/clinic/doctors";

export default async function DoctorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "schedules.read");
  const [t, format, doctors] = await Promise.all([getTranslations(), getFormatter(), listDoctors(ctx)]);
  const base = `/c/${ctx.tenant.slug}/doctors`;

  return (
    <>
      <PageHeader title={t("clinic.doctors.title")} description={t("clinic.doctors.subtitle")} />
      <Card className="overflow-hidden">
        {doctors.length === 0 ? (
          <EmptyState icon={<UserRound className="size-6" />} title={t("clinic.doctors.empty")} description={t("clinic.doctors.emptyHint")} />
        ) : (
          <Table caption={t("clinic.doctors.title")}>
            <thead>
              <tr>
                <Th>{t("clinic.staff.colName")}</Th>
                <Th>{t("clinic.doctors.specialty")}</Th>
                <Th>{t("clinic.doctors.schedule")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => (
                <tr key={d.membershipId} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`${base}/${d.membershipId}`} className="font-medium hover:text-accent">
                      {d.fullName}
                    </Link>
                    {d.profile?.department ? <p className="text-[12.5px] text-text-3">{d.profile.department.name}</p> : null}
                  </Td>
                  <Td className="text-text-2">{d.profile ? t(`specialties.${d.profile.specialty}` as never) : <Badge tone="warning">{t("clinic.doctors.noProfile")}</Badge>}</Td>
                  <Td className="tabular-nums text-text-2">
                    {d.weeklyMinutes > 0 ? t("clinic.doctors.perWeek", { hours: format.number(d.weeklyMinutes / 60, { maximumFractionDigits: 1 }) }) : <Badge>{t("clinic.doctors.noHours")}</Badge>}
                  </Td>
                  <Td className="text-right">
                    <Link href={`${base}/${d.membershipId}`} className="text-[14px] font-medium text-accent hover:underline">
                      {d.profile ? t("clinic.doctors.open") : t("clinic.doctors.setupProfile")}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
