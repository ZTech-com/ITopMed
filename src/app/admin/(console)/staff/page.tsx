import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { PlatformRole } from "@/generated/prisma/client";
import { requirePlatform } from "@/server/auth/guards";
import { platformCan } from "@/server/authz/platform";
import { platformDb } from "@/server/db";
import { suggestPassword } from "@/server/security/password";
import { createStaffAccountAction } from "../../actions";

export default async function PlatformStaffPage() {
  const p = await requirePlatform("staff.read");
  const canManage = platformCan(p.user.role, "staff.manage");
  const [t, format, staff] = await Promise.all([
    getTranslations(),
    getFormatter(),
    platformDb().platformUser.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, username: true, role: true, status: true, lastLoginAt: true },
    }),
  ]);
  // Network admins are appointed from their network page (they need a network).
  const roleOptions = Object.values(PlatformRole).filter((r) => r !== "NETWORK_ADMIN").map((r) => ({ value: r, label: t(`platformRole.${r}`) }));

  return (
    <>
      <PageHeader title={t("admin.staff.title")} description={t("admin.staff.subtitle")} />

      {canManage ? (
        <Card className="mb-6">
          <CardHeader title={t("admin.staff.inviteTitle")} description={t("admin.staff.inviteHint")} />
          <CardBody>
            <Form action={createStaffAccountAction}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField name="fullName" label={t("admin.staff.colName")} autoComplete="off" required />
                <SelectField name="role" label={t("admin.staff.colRole")} options={roleOptions} defaultValue="SUPPORT" />
                <TextField name="username" label={t("auth.username")} autoComplete="off" required />
                <TextField name="password" label={t("admin.clinicNew.ownerPassword")} hint={t("admin.clinicNew.ownerPasswordHint")} defaultValue={suggestPassword()} autoComplete="new-password" required />
              </div>
              <div className="flex justify-end">
                <SubmitButton>{t("admin.staff.create")}</SubmitButton>
              </div>
            </Form>
          </CardBody>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <Table caption={t("admin.staff.title")}>
          <thead>
            <tr>
              <Th>{t("admin.staff.colName")}</Th>
              <Th>{t("admin.staff.colRole")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("admin.staff.colLastLogin")}</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              return (
                <tr key={s.id}>
                  <Td>
                    <p className="font-medium">{s.fullName}</p>
                    <p className="break-all text-[13px] text-text-2">{s.username}</p>
                  </Td>
                  <Td className="text-text-2">{t(`platformRole.${s.role}`)}</Td>
                  <Td>
                    <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{t(`status.${s.status}`)}</Badge>
                  </Td>
                  <Td className="text-text-2">{s.lastLoginAt ? format.relativeTime(s.lastLoginAt) : t("common.never")}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {!canManage ? (
        <div className="mt-4">
          <Alert tone="neutral">{t("admin.staff.manageNote")}</Alert>
        </div>
      ) : null}
    </>
  );
}
