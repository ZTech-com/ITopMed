import { Building2, FlaskConical, Hospital, Smile, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { PRACTICE_TYPES, PRESET_MODULES, practiceProfile } from "@/server/clinic/practice";
import { SPECIALTIES } from "@/server/scheduling/specialties";
import { setupAction } from "../../../practice-actions";

const ICONS = { MULTI_SPECIALTY: Hospital, SOLO_PRACTICE: UserRound, DENTAL: Smile, DIAGNOSTIC: FlaskConical, OTHER: Building2 } as const;

/** Setup assistant: one screen that adapts ITop Med to the kind of practice. Owner only. */
export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "clinic.settings.manage");
  if (!ctx.roleKeys.includes("clinic_owner")) notFound();
  const [t, profile] = await Promise.all([getTranslations(), practiceProfile(ctx)]);
  const current = profile?.practiceType ?? "MULTI_SPECIALTY";
  const isDoctor = ctx.roleKeys.includes("doctor");
  const isFrontDesk = ctx.roleKeys.includes("receptionist") && ctx.roleKeys.includes("cashier");
  const check = (name: string, label: string, hint: string, defaultChecked: boolean) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-[13px] text-text-2">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow={ctx.tenant.name} title={t("setup.title")} description={t("setup.subtitle")} />
      <Form action={setupAction}>
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <Card>
          <CardHeader title={t("setup.typeTitle")} description={t("setup.typeHint")} />
          <CardBody>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{t("setup.typeTitle")}</legend>
              {PRACTICE_TYPES.map((p) => {
                const Icon = ICONS[p];
                return (
                  <label key={p} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="practiceType" value={p} defaultChecked={p === current} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        <Icon aria-hidden className="size-4 text-accent" />
                        {t(`practiceType.${p}.name`)}
                      </span>
                      <span className="mt-1 block text-[13px] text-text-2">{t(`practiceType.${p}.hint`)}</span>
                      <span className="mt-1.5 block text-[12px] text-text-3">
                        {t("setup.modulesOn")}: {PRESET_MODULES[p].map((m) => t(`modules.${m}` as never)).join(", ") || "—"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("setup.optionsTitle")} />
          <CardBody className="space-y-3">
            {check("applyModules", t("setup.applyModules"), t("setup.applyModulesHint"), true)}
            {check("addStarterServices", t("setup.addServices"), t("setup.addServicesHint"), true)}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("setup.ownerTitle")} description={t("setup.ownerHint")} />
          <CardBody className="space-y-3">
            {isDoctor ? (
              <p className="text-[14px] text-text-2">{t("setup.alreadyDoctor")}</p>
            ) : (
              <>
                {check("ownerIsDoctor", t("setup.ownerIsDoctor"), t("setup.ownerIsDoctorHint"), false)}
                <div className="max-w-sm">
                  <SelectField name="specialty" label={t("setup.specialty")} defaultValue="" options={[{ value: "", label: "—" }, ...SPECIALTIES.map((x) => ({ value: x, label: t(`specialties.${x}`) }))]} />
                </div>
                {check("weekdaySchedule", t("setup.schedule"), t("setup.scheduleHint"), true)}
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("setup.frontDeskTitle")} description={t("setup.frontDeskHint")} />
          <CardBody>
            {isFrontDesk ? <p className="text-[14px] text-text-2">{t("setup.alreadyFrontDesk")}</p> : check("ownerFrontDesk", t("setup.ownerFrontDesk"), t("setup.ownerFrontDeskHint"), false)}
          </CardBody>
        </Card>

        <SubmitButton full>{t("setup.submit")}</SubmitButton>
      </Form>
    </div>
  );
}
