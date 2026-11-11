import { getFormatter, getTranslations } from "next-intl/server";
import { roleLabel } from "@/lib/role-label";
import { CheckboxGroup, Form, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import { listRoles } from "@/server/clinic/roles";
import Link from "next/link";
import { requireClinic } from "@/server/auth/guards";
import { listStaff } from "@/server/clinic/admin";
import { inviteStaffAction } from "../../../clinic-actions";

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "staff.read");
  const [t, format, { members, invitations }] = await Promise.all([getTranslations(), getFormatter(), listStaff(ctx)]);
  const isOwner = ctx.roleKeys.includes("clinic_owner");
  const roles = await listRoles(ctx);
  const assignable = roles.filter((r) => r.key !== "clinic_owner" || isOwner);
  const customNames = new Map(roles.map((r) => [r.key, r.name]));

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
                      <p className="text-[13px] text-text-2">{m.user.email}</p>
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
          {invitations.length > 0 ? (
            <Card>
              <CardHeader title={t("clinic.staff.pending")} />
              <ul className="divide-y divide-border">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-6 py-3 text-[14px]">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.fullName}</p>
                      <p className="truncate text-[13px] text-text-2">
                        {i.email} · {i.roleKeys.map((r) => roleLabel(t as never, r, customNames.get(r))).join(", ")}
                      </p>
                    </div>
                    <Badge tone="accent">{t("status.PENDING")}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        {ctx.permissions.has("staff.manage") ? (
          <Card className="xl:col-span-2">
            <CardHeader title={t("clinic.staff.invite")} />
            <CardBody>
              <Form action={inviteStaffAction}>
                <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                <TextField name="fullName" label={t("clinic.staff.fullName")} autoComplete="off" required />
                <TextField name="email" type="email" label={t("clinic.staff.email")} inputMode="email" autoComplete="off" required />
                <CheckboxGroup name="roleKeys" label={t("clinic.staff.roles")} hint={t("clinic.staff.rolesHint")} options={assignable.map((r) => ({ value: r.key, label: roleLabel(t as never, r.key, r.name) }))} />
                <SubmitButton full>{t("clinic.staff.invite")}</SubmitButton>
              </Form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
