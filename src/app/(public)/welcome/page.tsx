import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { PRACTICE_TYPES } from "@/server/clinic/practice";
import { needsFirstRun } from "@/server/local/first-run";
import { SPECIALTIES } from "@/server/scheduling/specialties";
import { firstRunAction } from "../../first-run-actions";

/**
 * First start of a fresh local installation (packaged Windows app): one form
 * instead of command-line setup. Public by design while no account exists;
 * see completeFirstRun for who may submit it.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  if (!(await needsFirstRun())) redirect("/login");
  const t = await getTranslations();
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
    <AuthLayout title={t("welcome.title")} subtitle={t("welcome.subtitle")}>
      <Form action={firstRunAction}>
        <p className="text-[14px] font-semibold">{t("welcome.clinicSection")}</p>
        <TextField name="clinicName" label={t("welcome.clinicName")} placeholder={t("welcome.clinicNamePlaceholder")} required autoFocus />
        <SelectField name="practiceType" label={t("admin.clinicNew.sectionType")} defaultValue="SOLO_PRACTICE" options={PRACTICE_TYPES.map((p) => ({ value: p, label: t(`practiceType.${p}.name`) }))} />
        <SelectField
          name="focusSpecialty"
          label={t("admin.clinicNew.focusSpecialty")}
          defaultValue=""
          options={[{ value: "", label: "—" }, ...SPECIALTIES.map((x) => ({ value: x, label: t(`specialties.${x}`) }))]}
        />
        {check("ownerIsDoctor", t("welcome.iAmDoctor"), t("admin.clinicNew.ownerIsDoctorHint"), true)}
        {check("ownerFrontDesk", t("welcome.iAmFrontDesk"), t("admin.clinicNew.ownerFrontDeskHint"), true)}

        <p className="pt-2 text-[14px] font-semibold">{t("welcome.accountSection")}</p>
        <TextField name="fullName" label={t("welcome.fullName")} autoComplete="name" required />
        <TextField name="email" type="email" label={t("auth.email")} hint={t("welcome.emailHint")} autoComplete="email" inputMode="email" required />
        <TextField name="username" label={t("auth.username")} hint={t("welcome.usernameHint")} autoComplete="username" required />
        <TextField name="password" type="password" label={t("auth.password")} hint={t("welcome.passwordHint")} autoComplete="new-password" required />
        <TextField name="confirmPassword" type="password" label={t("welcome.confirmPassword")} autoComplete="new-password" required />

        <SubmitButton full>{t("welcome.submit")}</SubmitButton>
        <p className="text-center text-[12px] leading-relaxed text-text-3">{t("welcome.privacy")}</p>
      </Form>
    </AuthLayout>
  );
}
