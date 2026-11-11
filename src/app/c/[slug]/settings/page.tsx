import { getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { LOCALES, LOCALE_NATIVE_NAMES, TIMEZONES } from "@/i18n/config";
import { requireClinic } from "@/server/auth/guards";
import { getClinicSettings } from "@/server/clinic/admin";
import { clinicSettingsAction } from "../../../clinic-actions";

export default async function ClinicSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "clinic.settings.read");
  const [t, s] = await Promise.all([getTranslations(), getClinicSettings(ctx)]);
  const canEdit = ctx.permissions.has("clinic.settings.manage");
  const optional = t("common.optional");

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("clinic.settings.title")} description={t("clinic.settings.subtitle")} />
      <Form action={clinicSettingsAction} className="space-y-6">
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <fieldset disabled={!canEdit} className="space-y-6">
          <Card>
            <CardHeader title={t("clinic.settings.general")} />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <TextField name="name" label={t("admin.clinicNew.name")} defaultValue={s.name} required className="sm:col-span-2" />
              <TextField name="legalName" label={t("admin.clinicNew.legalName")} defaultValue={s.legalName} optionalLabel={optional} className="sm:col-span-2" />
              <TextField name="contactEmail" type="email" label={t("admin.clinicNew.contactEmail")} defaultValue={s.contactEmail} optionalLabel={optional} />
              <TextField name="contactPhone" type="tel" label={t("admin.clinicNew.contactPhone")} defaultValue={s.contactPhone} optionalLabel={optional} />
              <TextField name="address" label={t("admin.clinicNew.address")} defaultValue={s.address} optionalLabel={optional} className="sm:col-span-2" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("clinic.settings.regional")} />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <SelectField name="defaultLocale" label={t("admin.clinicNew.defaultLocale")} defaultValue={s.defaultLocale} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NATIVE_NAMES[l] }))} />
              <SelectField name="timezone" label={t("admin.clinicNew.timezone")} defaultValue={s.timezone} options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
            </CardBody>
          </Card>
        </fieldset>
        {canEdit ? (
          <div className="flex justify-end">
            <SubmitButton>{t("common.save")}</SubmitButton>
          </div>
        ) : null}
      </Form>
    </div>
  );
}
