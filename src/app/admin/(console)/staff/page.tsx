import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui/primitives";
import { PlatformRole } from "@/generated/prisma/client";
import { requirePlatform } from "@/server/auth/guards";
import { platformCan } from "@/server/authz/platform";
import { platformDb } from "@/server/db";
import { listPendingPlatformInvitations } from "@/server/platform/staff";
import { inviteStaffAction, staffInvitationAction } from "../../actions";

export default async function PlatformStaffPage() {
  const p = await requirePlatform("staff.read");
  const canManage = platformCan(p.user.role, "staff.manage");
  const [t, format, staff, invitations] = await Promise.all([
    getTranslations(),
    getFormatter(),
    platformDb().platformUser.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, username: true, email: true, role: true, status: true, telegramLinkedAt: true, lastLoginAt: true },
    }),
    listPendingPlatformInvitations(p),
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
            <Form action={inviteStaffAction}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField name="fullName" label={t("admin.staff.colName")} autoComplete="off" required />
                <TextField name="email" type="email" label={t("auth.email")} autoComplete="off" required />
                <SelectField name="role" label={t("admin.staff.colRole")} options={roleOptions} defaultValue="SUPPORT" />
              </div>
              <div className="flex justify-end">
                <SubmitButton>{t("admin.staff.invite")}</SubmitButton>
              </div>
            </Form>
          </CardBody>
        </Card>
      ) : null}

      {invitations.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title={t("admin.staff.pendingTitle")} />
          <ul className="divide-y divide-border">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <p className="font-medium">{inv.fullName}</p>
                  <p className="text-[13px] text-text-2">
                    {inv.email} · {t(`platformRole.${inv.role}`)}
                  </p>
                  <p className="text-[13px] text-text-3">
                    {t("admin.staff.invitedBy", { name: inv.invitedBy.fullName })} · {inv.expiresAt > new Date() ? t("admin.staff.expires", { when: format.relativeTime(inv.expiresAt) }) : t("admin.staff.expired")}
                  </p>
                </div>
                {canManage ? (
                  <Form action={staffInvitationAction} className="space-y-3">
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <div className="flex gap-2">
                      <button name="op" value="resend" className={buttonClass("secondary", "sm")}>
                        {t("admin.clinicDetail.resend")}
                      </button>
                      <button name="op" value="revoke" className={buttonClass("ghost", "sm")}>
                        {t("admin.clinicDetail.revoke")}
                      </button>
                    </div>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <Table caption={t("admin.staff.title")}>
          <thead>
            <tr>
              <Th>{t("admin.staff.colName")}</Th>
              <Th>{t("admin.staff.colRole")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("security.telegram")}</Th>
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
                  <Td>
                    <Badge tone={s.telegramLinkedAt ? "success" : "neutral"}>{s.telegramLinkedAt ? t("security.telegramOn") : t("security.telegramOff")}</Badge>
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
