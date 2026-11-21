import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PermissionPicker } from "@/components/permission-picker";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { LOCKED_ROLE_KEYS, getRole } from "@/server/clinic/roles";
import { deleteRoleAction, updateRoleAction } from "../../../../clinic-actions";

const UUID = /^[0-9a-f-]{36}$/;

export default async function RoleEditPage({ params, searchParams }: { params: Promise<{ slug: string; roleId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { slug, roleId } = await params;
  if (!UUID.test(roleId)) notFound();
  const ctx = await requireClinic(slug, "roles.manage");
  const [t, role, sp] = await Promise.all([getTranslations(), getRole(ctx, roleId), searchParams]);
  if (!role) notFound();
  const locked = LOCKED_ROLE_KEYS.has(role.key);
  const title = role.isSystem ? t(`roles.${role.key}` as never) : (role.name ?? role.key);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader eyebrow={t("clinic.roles.title")} title={title} description={t("clinic.roles.permissionsCount", { count: role.permissions.length })} />
      {sp.created ? <div className="mb-6"><Alert tone="success">{t("clinic.roles.created")}</Alert></div> : null}
      {locked ? <div className="mb-6"><Alert tone="neutral">{t("clinic.roles.locked")}</Alert></div> : null}

      <Card>
        <CardBody>
          <Form action={updateRoleAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <input type="hidden" name="roleId" value={role.id} />
            {!role.isSystem ? <TextField name="name" label={t("clinic.roles.name")} defaultValue={role.name} required className="max-w-md" /> : null}
            <PermissionPicker selected={new Set(role.permissions.map((p) => p.permission))} disabled={locked} />
            {!locked ? (
              <div className="flex justify-end">
                <SubmitButton>{t("common.save")}</SubmitButton>
              </div>
            ) : null}
          </Form>
        </CardBody>
      </Card>

      {!role.isSystem ? (
        <Card className="mt-6">
          <CardHeader title={t("clinic.roles.delete")} />
          <CardBody>
            <Form action={deleteRoleAction}>
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <input type="hidden" name="roleId" value={role.id} />
              <SubmitButton variant="danger">{t("clinic.roles.delete")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
