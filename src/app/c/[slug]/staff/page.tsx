import { getFormatter, getTranslations } from "next-intl/server";
import { roleLabel } from "@/lib/role-label";
import { CheckboxGroup, Form, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import { listRoles } from "@/server/clinic/roles";
import Link from "next/link";
import { requireClinic } from "@/server/auth/guards";
import { listStaff } from "@/server/clinic/admin";
import { addStaffAction } from "../../../clinic-actions";
import { suggestPassword } from "@/server/security/password";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "staff.read");
  const [t, format, { members }] = await Promise.all([getTranslations(), getFormatter(), listStaff(ctx)]);
  const isOwner = ctx.roleKeys.includes("clinic_owner");
  const roles = await listRoles(ctx);
  const assignable = roles.filter((r) => r.key !== "clinic_owner" || isOwner);

  return (
    <>
      <PageHeader title={t("clinic.staff.title")} description={t("clinic.staff.subtitle")} />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Card className="overflow-hidden">
            <CardHeader title={t("clinic.staff.members")} />
            <Table caption={t("clinic.staff.members")}>
              <thead>
                <tr>
                  <Th>{t("clinic.staff.colName")}</Th>
                  <Th>{t("clinic.staff.colRoles")}</Th>
                  <Th>{t("clinic.staff.colStatus")}</Th>
                  <Th>{t("clinic.staff.colLastLogin")}</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <Link href={`/c/${ctx.tenant.slug}/staff/${m.id}`} className="font-medium hover:text-accent">
                        {m.user.fullName}
                      </Link>
                      <p className="break-all text-[13px] text-text-2">{m.user.username}</p>
                    </Td>
                    <Td className="text-text-2">{m.roles.map((r) => roleLabel(t as never, r.role.key, r.role.name)).join(", ")}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[m.status]}>{t(`status.${m.status}`)}</Badge>
                    </Td>
                    <Td className="text-text-2">{m.user.lastLoginAt ? format.relativeTime(m.user.lastLoginAt) : t("common.never")}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        {ctx.permissions.has("staff.manage") ? (
          <Card className="xl:col-span-2">
            <CardHeader title={t("clinic.staff.invite")} description={t("clinic.staff.addHint")} />
            <CardBody>
              <Form action={addStaffAction}>
                <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                <TextField name="fullName" label={t("clinic.staff.fullName")} autoComplete="off" required />
                <CheckboxGroup name="roleKeys" label={t("clinic.staff.roles")} hint={t("clinic.staff.rolesHint")} options={assignable.map((r) => ({ value: r.key, label: roleLabel(t as never, r.key, r.name) }))} />
                <TextField name="username" label={t("clinic.staff.username")} hint={t("clinic.staff.usernameHint")} autoComplete="off" required />
                <TextField name="password" label={t("clinic.staff.password")} hint={t("clinic.staff.passwordHint")} defaultValue={suggestPassword()} autoComplete="new-password" required />
                <SubmitButton full>{t("clinic.staff.add")}</SubmitButton>
              </Form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
