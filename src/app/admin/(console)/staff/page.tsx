import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { platformDb } from "@/server/db";

export default async function PlatformStaffPage() {
  await requirePlatform("staff.read");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const staff = await platformDb().platformUser.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true, email: true, role: true, status: true, mfaEnabledAt: true, lastLoginAt: true },
  });
  return (
    <>
      <PageHeader title={t("admin.staff.title")} description={t("admin.staff.subtitle")} />
      <div className="mb-4">
        <Alert tone="neutral">{t("admin.staff.cliNote")}</Alert>
      </div>
      <Card className="overflow-hidden">
        <Table caption={t("admin.staff.title")}>
          <thead>
            <tr>
              <Th>{t("admin.staff.colName")}</Th>
              <Th>{t("admin.staff.colRole")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("admin.staff.colMfa")}</Th>
              <Th>{t("admin.staff.colLastLogin")}</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="font-medium">{s.fullName}</p>
                  <p className="text-[13px] text-text-2">{s.email}</p>
                </Td>
                <Td className="text-text-2">{t(`platformRole.${s.role}`)}</Td>
                <Td>
                  <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{t(`status.${s.status}`)}</Badge>
                </Td>
                <Td>
                  <Badge tone={s.mfaEnabledAt ? "success" : "warning"}>{s.mfaEnabledAt ? t("admin.staff.mfaOn") : t("admin.staff.mfaOff")}</Badge>
                </Td>
                <Td className="text-text-2">{s.lastLoginAt ? format.relativeTime(s.lastLoginAt) : t("common.never")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
