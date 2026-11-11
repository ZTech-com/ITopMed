import { getLocale, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { LOCALES, LOCALE_NATIVE_NAMES, TIMEZONES } from "@/i18n/config";
import { localizedName } from "@/lib/localized";
import { requirePlatform } from "@/server/auth/guards";
import { platformDb } from "@/server/db";
import { createClinicAction } from "../../../actions";

export default async function NewClinicPage() {
  await requirePlatform("tenants.create");
  const [t, locale, plans] = await Promise.all([
    getTranslations("admin.clinicNew"),
    getLocale(),
    platformDb().plan.findMany({ where: { isActive: true }, orderBy: { maxUsers: { sort: "asc", nulls: "last" } } }),
  ]);
  const optional = (await getTranslations("common"))("optional");

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Form action={createClinicAction} className="space-y-6">
        <Card>
          <CardHeader title={t("sectionClinic")} />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <TextField name="name" label={t("name")} required className="sm:col-span-2" autoFocus />
            <TextField name="slug" label={t("slug")} hint={t("slugHint")} placeholder="medlife-tashkent" required className="sm:col-span-2" />
            <TextField name="legalName" label={t("legalName")} optionalLabel={optional} />
            <TextField name="taxId" label={t("taxId")} hint={t("taxIdHint")} inputMode="numeric" optionalLabel={optional} />
            <TextField name="contactEmail" type="email" label={t("contactEmail")} inputMode="email" required />
            <TextField name="contactPhone" type="tel" label={t("contactPhone")} inputMode="tel" placeholder="+998" optionalLabel={optional} />
            <TextField name="address" label={t("address")} optionalLabel={optional} className="sm:col-span-2" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("sectionSettings")} />
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <SelectField name="planCode" label={t("plan")} options={plans.map((p) => ({ value: p.code, label: localizedName(p.name, locale) }))} defaultValue="professional" />
            <SelectField name="defaultLocale" label={t("defaultLocale")} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NATIVE_NAMES[l] }))} defaultValue="uz-Latn" />
            <SelectField name="timezone" label={t("timezone")} options={TIMEZONES.map((z) => ({ value: z, label: z }))} defaultValue="Asia/Tashkent" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("sectionOwner")} description={t("ownerHint")} />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <TextField name="ownerFullName" label={t("ownerFullName")} autoComplete="off" required />
            <TextField name="ownerEmail" type="email" label={t("ownerEmail")} inputMode="email" autoComplete="off" required />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <SubmitButton>{t("submit")}</SubmitButton>
        </div>
      </Form>
    </div>
  );
}
