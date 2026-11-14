import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PermissionPicker } from "@/components/permission-picker";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listRoles } from "@/server/clinic/roles";
import { createRoleAction } from "../../../clinic-actions";

export default async function RolesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "roles.manage");
  const [t, roles, sp] = await Promise.all([getTranslations(), listRoles(ctx), searchParams]);
  const base = `/c/${ctx.tenant.slug}/roles`;
  const roleName = (r: { key: string; name: string | null; isSystem: boolean }) => (r.isSystem ? t(`roles.${r.key}` as never) : (r.name ?? r.key));

  return (
    <>
      <PageHeader title={t("clinic.roles.title")} description={t("clinic.roles.subtitle")} />
      {sp.deleted ? <div className="mb-6"><Alert tone="success">{t("clinic.roles.deleted")}</Alert></div> : null}
      <Card className="overflow-hidden">
        <Table caption={t("clinic.roles.title")}>
          <thead>
            <tr>
              <Th>{t("clinic.roles.colRole")}</Th>
              <Th>{t("clinic.roles.colPermissions")}</Th>
              <Th className="text-right">{t("clinic.roles.colMembers")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <span className="font-medium">{roleName(r)}</span>{" "}
                  <span className="ml-1 align-middle">
                    <Badge tone={r.isSystem ? "neutral" : "accent"}>{r.isSystem ? t("clinic.roles.standard") : t("clinic.roles.custom")}</Badge>
                  </span>
                </Td>
                <Td className="text-text-2">{t("clinic.roles.permissionsCount", { count: r.permissions.length })}</Td>
                <Td label={t("clinic.roles.colMembers")} className="text-right tabular-nums">{r._count.members}</Td>
                <Td className="text-right">
                  <Link href={`${base}/${r.id}`} className="text-[14px] font-medium text-accent hover:underline">
                    {t("clinic.roles.edit")}
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("clinic.roles.create")} />
        <CardBody>
          <Form action={createRoleAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <TextField name="name" label={t("clinic.roles.name")} required className="max-w-md" />
            <PermissionPicker selected={new Set()} />
            <div className="flex justify-end">
              <SubmitButton>{t("clinic.roles.create")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>
    </>
  );
}
