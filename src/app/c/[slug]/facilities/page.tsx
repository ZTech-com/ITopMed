import { getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listBranches } from "@/server/clinic/admin";
import { canUseBranch } from "@/server/clinic/context";
import { ROOM_KINDS, listDepartments, listRooms } from "@/server/clinic/resources";
import { archiveFacilityAction, createDepartmentAction, createRoomAction } from "../../../workspace-actions";

export default async function FacilitiesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "clinic.settings.read");
  const canManage = ctx.permissions.has("clinic.branches.manage");
  const [t, departments, rooms, allBranches] = await Promise.all([getTranslations(), listDepartments(ctx), listRooms(ctx), listBranches(ctx)]);
  const branches = allBranches.filter((b) => canUseBranch(ctx, b.id));

  const archiveButton = (type: "room" | "department", id: string) =>
    canManage ? (
      <Form action={archiveFacilityAction} className="space-y-0">
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="id" value={id} />
        <button className={buttonClass("ghost", "sm")}>{t("clinic.facilities.archive")}</button>
      </Form>
    ) : null;

  return (
    <>
      <PageHeader title={t("clinic.facilities.title")} description={t("clinic.facilities.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("clinic.facilities.departments")} />
            {departments.length === 0 ? (
              <CardBody><p className="text-[14px] text-text-2">{t("clinic.facilities.emptyDepartments")}</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {departments.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-6 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{d.name}</p>
                      <p className="text-[12.5px] text-text-3">{d.branch?.name ?? t("clinic.facilities.anyBranch")}</p>
                    </div>
                    {archiveButton("department", d.id)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canManage ? (
            <Card>
              <CardHeader title={t("clinic.facilities.addDepartment")} />
              <CardBody>
                <Form action={createDepartmentAction}>
                  <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                  <TextField name="name" label={t("clinic.facilities.departmentName")} required />
                  <SelectField name="branchId" label={t("clinic.facilities.branch")} defaultValue="" options={[{ value: "", label: t("clinic.facilities.anyBranch") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
                  <SubmitButton full variant="secondary">{t("clinic.facilities.addDepartment")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("clinic.facilities.rooms")} />
            {rooms.length === 0 ? (
              <CardBody><p className="text-[14px] text-text-2">{t("clinic.facilities.emptyRooms")}</p></CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {rooms.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{r.name}</p>
                      <p className="text-[12.5px] text-text-3">
                        {t(`roomKind.${r.kind}`)} · {r.branch.name}
                      </p>
                    </div>
                    {archiveButton("room", r.id)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canManage && branches.length > 0 ? (
            <Card>
              <CardHeader title={t("clinic.facilities.addRoom")} />
              <CardBody>
                <Form action={createRoomAction}>
                  <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                  <TextField name="name" label={t("clinic.facilities.roomName")} required />
                  <SelectField name="branchId" label={t("clinic.facilities.branch")} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                  <SelectField name="kind" label={t("clinic.facilities.roomKind")} options={ROOM_KINDS.map((k) => ({ value: k, label: t(`roomKind.${k}`) }))} />
                  <SubmitButton full variant="secondary">{t("clinic.facilities.addRoom")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
