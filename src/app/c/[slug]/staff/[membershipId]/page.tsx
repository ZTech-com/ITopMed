import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SubmitButton } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listOperationalBranches } from "@/server/clinic/context";
import { getMember } from "@/server/clinic/members";
import { listRoles } from "@/server/clinic/roles";
import { DomainError } from "@/server/tenancy/provisioning";
import { memberAccessAction, memberStatusAction } from "../../../../clinic-actions";

const choice =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft";

export default async function MemberPage({ params }: { params: Promise<{ slug: string; membershipId: string }> }) {
  const { slug, membershipId } = await params;
  const ctx = await requireClinic(slug, "staff.read");
  const member = await getMember(ctx, membershipId).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const [t, format, roles, branches] = await Promise.all([getTranslations(), getFormatter(), listRoles(ctx), listOperationalBranches(ctx)]);

  const isSelf = member.userId === ctx.principal.user.id;
  const targetIsOwner = member.roles.some((r) => r.role.key === "clinic_owner");
  const callerIsOwner = ctx.roleKeys.includes("clinic_owner");
  const canEdit = ctx.permissions.has("staff.manage") && !isSelf && (!targetIsOwner || callerIsOwner);
  const memberRoleIds = new Set(member.roles.map((r) => r.roleId));
  const memberBranchIds = new Set(member.branches.map((b) => b.branchId));
  const roleName = (r: { key: string; name: string | null; isSystem: boolean }) => (r.isSystem ? t(`roles.${r.key}` as never) : (r.name ?? r.key));
  const assignable = roles.filter((r) => r.key !== "clinic_owner" || callerIsOwner);

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={t("clinic.staff.title")} title={member.user.fullName} description={member.user.email} action={<Badge tone={STATUS_TONE[member.status]}>{t(`status.${member.status}`)}</Badge>} />

      {isSelf ? <div className="mb-6"><Alert tone="neutral">{t("clinic.member.selfNote")}</Alert></div> : null}
      {!isSelf && targetIsOwner && !callerIsOwner ? <div className="mb-6"><Alert tone="neutral">{t("clinic.member.ownerNote")}</Alert></div> : null}

      <Card className="mb-6">
        <CardBody>
          <DescriptionList
            items={[
              { label: t("clinic.staff.colRoles"), value: member.roles.map((r) => roleName(r.role)).join(", ") },
              { label: t("clinic.staff.colLastLogin"), value: member.user.lastLoginAt ? format.relativeTime(member.user.lastLoginAt) : t("common.never") },
              { label: t("clinic.member.mfa"), value: <Badge tone={member.user.mfaEnabledAt ? "success" : "neutral"}>{member.user.mfaEnabledAt ? t("clinic.member.mfaOn") : t("clinic.member.mfaOff")}</Badge> },
            ]}
          />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title={t("clinic.member.access")} />
        <CardBody>
          <Form action={memberAccessAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <input type="hidden" name="membershipId" value={member.id} />
            <fieldset disabled={!canEdit} className="space-y-6">
              <div>
                <legend className="text-[13px] font-medium">{t("clinic.member.roles")}</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {assignable.map((r) => (
                    <label key={r.id} className={choice}>
                      <input type="checkbox" name="roleIds" value={r.id} defaultChecked={memberRoleIds.has(r.id)} className="size-4 accent-[var(--accent)]" />
                      {roleName(r)}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[13px] font-medium">{t("clinic.member.branches")}</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className={choice}>
                    <input type="radio" name="branchScope" value="all" defaultChecked={member.allBranches} className="size-4 accent-[var(--accent)]" />
                    {t("clinic.member.allBranches")}
                  </label>
                  <label className={choice}>
                    <input type="radio" name="branchScope" value="selected" defaultChecked={!member.allBranches} className="size-4 accent-[var(--accent)]" />
                    {t("clinic.member.selectedBranches")}
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {branches.map((b) => (
                    <label key={b.id} className={choice}>
                      <input type="checkbox" name="branchIds" value={b.id} defaultChecked={memberBranchIds.has(b.id)} className="size-4 accent-[var(--accent)]" />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
            {canEdit ? (
              <div className="flex justify-end">
                <SubmitButton>{t("common.save")}</SubmitButton>
              </div>
            ) : null}
          </Form>
        </CardBody>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader title={t("clinic.member.lifecycle")} />
          <CardBody>
            <Form action={memberStatusAction}>
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <input type="hidden" name="membershipId" value={member.id} />
              <div className="flex flex-wrap gap-2">
                {member.status === "ACTIVE" ? (
                  <button name="op" value="suspend" className={buttonClass("secondary")}>{t("clinic.member.suspend")}</button>
                ) : null}
                {member.status === "SUSPENDED" ? (
                  <button name="op" value="reactivate" className={buttonClass("primary")}>{t("clinic.member.reactivate")}</button>
                ) : null}
                {member.status !== "REMOVED" ? (
                  <button name="op" value="remove" className={buttonClass("danger")}>{t("clinic.member.remove")}</button>
                ) : null}
              </div>
            </Form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
