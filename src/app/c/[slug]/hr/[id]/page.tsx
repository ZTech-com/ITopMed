import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { roleLabel } from "@/lib/role-label";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { CREDENTIAL_KINDS, CREDENTIAL_WARNING_DAYS, EMPLOYMENT_TYPES, LEAVE_KINDS, getStaffHr } from "@/server/hr/hr";
import { listIssueDepartments } from "@/server/inventory/inventory";
import { addDays, dbDateToLocalDate, localDateToDbDate, todayIn } from "@/server/scheduling/time";
import { DomainError } from "@/server/tenancy/provisioning";
import { hrCredentialAction, hrLeaveAction, hrProfileAction } from "../../../../inventory-hr-actions";

export default async function StaffHrPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "hr.read");
  const canManage = ctx.permissions.has("hr.manage");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  let data: Awaited<ReturnType<typeof getStaffHr>>;
  try {
    data = await getStaffHr(ctx, id);
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const departments = canManage ? await listIssueDepartments(ctx) : [];
  const { profile, credentials, leaves, roles, user } = data;
  const s = ctx.tenant.slug;
  const today = localDateToDbDate(todayIn(ctx.tenant.timezone));
  const soon = localDateToDbDate(addDays(todayIn(ctx.tenant.timezone), CREDENTIAL_WARNING_DAYS));
  const d = (x: Date) => format.dateTime(x, { dateStyle: "medium", timeZone: "UTC" });
  const hidden = (
    <>
      <input type="hidden" name="$slug" value={s} />
      <input type="hidden" name="membershipId" value={data.membership.id} />
    </>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader eyebrow={t("clinic.hr.title")} title={user?.fullName ?? "—"} description={roles.map((r) => roleLabel(t as never, r.key, r.name)).join(", ")} />
      {data.isDoctor ? <Alert tone="accent">{t("clinic.hr.doctorLeaveNote")}</Alert> : null}

      <Card>
        <CardHeader title={t("clinic.hr.profile")} description={t("clinic.hr.profileHint")} />
        <CardBody>
          {canManage ? (
            <Form action={hrProfileAction}>
              {hidden}
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField name="personnelNumber" label={t("clinic.hr.personnelNumber")} defaultValue={profile?.personnelNumber} optionalLabel={t("common.optional")} />
                <TextField name="position" label={t("clinic.hr.position")} defaultValue={profile?.position} optionalLabel={t("common.optional")} />
                <SelectField name="departmentId" label={t("clinic.hr.department")} defaultValue={profile?.departmentId ?? ""} options={[{ value: "", label: "—" }, ...departments.map((x) => ({ value: x.id, label: x.name }))]} />
                <SelectField name="employmentType" label={t("clinic.hr.employmentType")} defaultValue={profile?.employmentType ?? "FULL_TIME"} options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: t(`employmentType.${x}`) }))} />
                <TextField name="hiredOn" type="date" label={t("clinic.hr.hiredOn")} defaultValue={profile?.hiredOn ? dbDateToLocalDate(profile.hiredOn) : undefined} optionalLabel={t("common.optional")} />
                <TextField name="workPhone" type="tel" label={t("clinic.hr.workPhone")} defaultValue={profile?.workPhone} optionalLabel={t("common.optional")} />
              </div>
              <SubmitButton>{t("common.save")}</SubmitButton>
            </Form>
          ) : (
            <DescriptionList
              items={[
                { label: t("clinic.hr.personnelNumber"), value: profile?.personnelNumber ?? "—" },
                { label: t("clinic.hr.position"), value: profile?.position ?? "—" },
                { label: t("clinic.hr.employmentType"), value: profile ? t(`employmentType.${profile.employmentType}`) : "—" },
                { label: t("clinic.hr.hiredOn"), value: profile?.hiredOn ? d(profile.hiredOn) : "—" },
                { label: t("clinic.hr.workPhone"), value: profile?.workPhone ?? "—" },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("clinic.hr.credentials")} description={t("clinic.hr.credentialsHint")} />
        {credentials.length === 0 ? (
          <CardBody>
            <p className="text-[14px] text-text-2">{t("clinic.hr.noCredentials")}</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {credentials.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-[14px]">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.title} <span className="font-normal text-text-3">· {t(`credentialKind.${c.kind}`)}</span>
                  </p>
                  <p className="text-[12.5px] text-text-3">
                    {[c.number, c.issuer, c.issuedOn ? t("clinic.hr.issued", { date: d(c.issuedOn) }) : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.expiresOn ? (
                    <Badge tone={c.expiresOn < today ? "danger" : c.expiresOn <= soon ? "warning" : "success"}>
                      {c.expiresOn < today ? t("clinic.hr.expiredOn", { date: d(c.expiresOn) }) : t("clinic.hr.validUntil", { date: d(c.expiresOn) })}
                    </Badge>
                  ) : (
                    <Badge>{t("clinic.hr.noExpiry")}</Badge>
                  )}
                  {canManage ? (
                    <Form action={hrCredentialAction} className="space-y-0">
                      <input type="hidden" name="$slug" value={s} />
                      <input type="hidden" name="credentialId" value={c.id} />
                      <button name="op" value="archive" className={buttonClass("ghost", "sm")}>
                        {t("clinic.hr.archive")}
                      </button>
                    </Form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <CardBody className="border-t border-border">
            <Form action={hrCredentialAction}>
              {hidden}
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField name="kind" label={t("clinic.hr.credentialKind")} options={CREDENTIAL_KINDS.map((x) => ({ value: x, label: t(`credentialKind.${x}`) }))} />
                <TextField name="title" label={t("clinic.hr.credentialTitle")} required className="sm:col-span-2" />
                <TextField name="number" label={t("clinic.hr.number")} optionalLabel={t("common.optional")} />
                <TextField name="issuer" label={t("clinic.hr.issuer")} optionalLabel={t("common.optional")} className="sm:col-span-2" />
                <TextField name="issuedOn" type="date" label={t("clinic.hr.issuedOn")} optionalLabel={t("common.optional")} />
                <TextField name="expiresOn" type="date" label={t("clinic.hr.expiresOn")} optionalLabel={t("common.optional")} />
              </div>
              <SubmitButton variant="secondary">{t("clinic.hr.addCredential")}</SubmitButton>
            </Form>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t("clinic.hr.leave")} description={t("clinic.hr.leaveHint")} />
        {leaves.length === 0 ? (
          <CardBody>
            <p className="text-[14px] text-text-2">{t("clinic.hr.noLeave")}</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {leaves.map((l) => (
              <li key={l.id} className={`flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-[14px] ${l.status === "CANCELLED" ? "text-text-3 line-through" : ""}`}>
                <div>
                  <p className="font-medium">{t(`leaveKind.${l.kind}`)}</p>
                  <p className="text-[12.5px] text-text-3">
                    {d(l.startsOn)} — {d(l.endsOn)}
                  </p>
                </div>
                {canManage && l.status === "APPROVED" && l.endsOn >= today ? (
                  <Form action={hrLeaveAction} className="space-y-0">
                    <input type="hidden" name="$slug" value={s} />
                    <input type="hidden" name="leaveId" value={l.id} />
                    <button name="op" value="cancel" className={buttonClass("ghost", "sm")}>
                      {t("clinic.hr.cancelLeave")}
                    </button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <CardBody className="border-t border-border">
            <Form action={hrLeaveAction}>
              {hidden}
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField name="kind" label={t("clinic.hr.leaveKind")} options={LEAVE_KINDS.map((x) => ({ value: x, label: t(`leaveKind.${x}`) }))} />
                <TextField name="startsOn" type="date" label={t("clinic.hr.from")} required />
                <TextField name="endsOn" type="date" label={t("clinic.hr.to")} required />
              </div>
              <SubmitButton variant="secondary">{t("clinic.hr.recordLeave")}</SubmitButton>
            </Form>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
