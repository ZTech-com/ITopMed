import { Building2, FlaskConical, Hospital, Smile, UserRound } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { LOCALES, LOCALE_NATIVE_NAMES, TIMEZONES } from "@/i18n/config";
import { localizedName } from "@/lib/localized";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { PRACTICE_TYPES, PRESET_MODULES } from "@/server/clinic/practice";
import { platformDb } from "@/server/db";
import { SPECIALTIES } from "@/server/scheduling/specialties";
import { suggestPassword } from "@/server/security/password";
import { createClinicAction } from "../../../actions";

const ICONS = { MULTI_SPECIALTY: Hospital, SOLO_PRACTICE: UserRound, DENTAL: Smile, DIAGNOSTIC: FlaskConical, OTHER: Building2 } as const;

export default async function NewClinicPage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const p = await requirePlatform("tenants.create");
  const sp = await searchParams;
  const isNetworkAdmin = p.user.role === "NETWORK_ADMIN";
  const db = platformDb();
  const [t, tAll, locale, plans, networks, myNetwork] = await Promise.all([
    getTranslations("admin.clinicNew"),
    getTranslations(),
    getLocale(),
    db.plan.findMany({ where: { isActive: true }, orderBy: { maxUsers: { sort: "asc", nulls: "last" } } }),
    platformCan(p.user.role, "networks.manage") ? db.network.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    isNetworkAdmin && p.user.networkId ? db.network.findUnique({ where: { id: p.user.networkId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const optional = (await getTranslations("common"))("optional");
  const check = (name: string, label: string, hint: string, defaultChecked: boolean) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-[13px] text-text-2">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitleNew")} />
      <Form action={createClinicAction} className="space-y-6">
        <Card>
          <CardHeader title={t("sectionType")} description={t("sectionTypeHint")} />
          <CardBody className="space-y-4">
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t("sectionType")}</legend>
              {PRACTICE_TYPES.map((pt) => {
                const Icon = ICONS[pt];
                return (
                  <label key={pt} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="practiceType" value={pt} defaultChecked={pt === "SOLO_PRACTICE"} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                        {tAll(`practiceType.${pt}.name`)}
                      </span>
                      <span className="mt-1 block text-[13px] text-text-2">{tAll(`practiceType.${pt}.hint`)}</span>
                      <span className="mt-1.5 block text-[12px] text-text-3">
                        {tAll("setup.modulesOn")}: {PRESET_MODULES[pt].map((m) => tAll(`modules.${m}` as never)).join(", ") || "—"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="max-w-sm">
              <SelectField
                name="focusSpecialty"
                label={t("focusSpecialty")}
                hint={t("focusSpecialtyHint")}
                defaultValue="cardiology"
                options={[{ value: "", label: "—" }, ...SPECIALTIES.map((x) => ({ value: x, label: tAll(`specialties.${x}`) }))]}
              />
            </div>
            {check("ownerIsDoctor", t("ownerIsDoctor"), t("ownerIsDoctorHint"), true)}
            {check("ownerFrontDesk", t("ownerFrontDesk"), t("ownerFrontDeskHint"), true)}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("sectionClinic")} />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <TextField name="name" label={t("name")} required className="sm:col-span-2" autoFocus />
            <TextField name="slug" label={t("slug")} hint={t("slugHint")} placeholder="shifo-kardio" required className="sm:col-span-2" />
            <TextField name="legalName" label={t("legalName")} optionalLabel={optional} />
            <TextField name="taxId" label={t("taxId")} hint={t("taxIdHint")} inputMode="numeric" optionalLabel={optional} />
            <TextField name="contactPhone" type="tel" label={t("contactPhone")} inputMode="tel" placeholder="+998" optionalLabel={optional} />
            <TextField name="address" label={t("address")} optionalLabel={optional} className="sm:col-span-2" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("sectionOwner")} description={t("ownerHintNew")} />
          <CardBody className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="ownerFullName" label={t("ownerFullName")} autoComplete="off" required className="sm:col-span-2" />
              <TextField name="ownerUsername" label={t("ownerUsername")} hint={t("ownerUsernameHint")} autoComplete="off" required />
              <TextField name="ownerPassword" label={t("ownerPassword")} hint={t("ownerPasswordHint")} defaultValue={suggestPassword()} autoComplete="new-password" required />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("sectionSettings")} />
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <SelectField name="planCode" label={t("plan")} options={plans.map((pl) => ({ value: pl.code, label: localizedName(pl.name, locale) }))} defaultValue="professional" />
            <SelectField name="defaultLocale" label={t("defaultLocale")} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NATIVE_NAMES[l] }))} defaultValue="uz-Latn" />
            <SelectField name="timezone" label={t("timezone")} options={TIMEZONES.map((z) => ({ value: z, label: z }))} defaultValue="Asia/Tashkent" />
            {isNetworkAdmin ? (
              <p className="text-[14px] text-text-2 sm:col-span-3">{t("networkFixed", { name: myNetwork?.name ?? "—" })}</p>
            ) : networks.length > 0 ? (
              <div className="sm:col-span-3 sm:max-w-sm">
                <SelectField name="networkId" label={t("network")} hint={t("networkHint")} defaultValue={sp.network ?? ""} options={[{ value: "", label: t("networkNone") }, ...networks.map((n) => ({ value: n.id, label: n.name }))]} />
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <SubmitButton>{t("submit")}</SubmitButton>
        </div>
      </Form>
    </div>
  );
}
