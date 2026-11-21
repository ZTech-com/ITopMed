import { getTranslations } from "next-intl/server";
import { DuplicateReview } from "@/components/duplicate-review";
import { PatientFields } from "@/components/patients";
import { Form, SelectField, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { CONSENT_METHODS, CONSENT_PURPOSES } from "@/server/patients/patients";
import { registerPatientAction } from "../../../../care-actions";

const choice =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft";

export default async function NewPatientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "patients.create");
  const t = await getTranslations();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader eyebrow={t("clinic.patients.title")} title={t("clinic.patients.register")} />
      <Form action={registerPatientAction} className="space-y-6">
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <Card>
          <CardBody>
            <PatientFields />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("clinic.patients.consentsTitle")} description={t("clinic.patients.consentsHint")} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CONSENT_PURPOSES.map((p) => (
                <label key={p} className={choice}>
                  <input type="checkbox" name="consents" value={p} className="size-4 accent-[var(--accent)]" />
                  {t(`consentPurpose.${p}`)}
                </label>
              ))}
            </div>
            <SelectField name="consentMethod" label={t("clinic.patients.consentMethod")} defaultValue="PAPER_SIGNED" options={CONSENT_METHODS.map((m) => ({ value: m, label: t(`consentMethod.${m}`) }))} />
          </CardBody>
        </Card>
        <DuplicateReview slug={ctx.tenant.slug} />
        <div className="flex justify-end">
          <SubmitButton>{t("clinic.patients.register")}</SubmitButton>
        </div>
      </Form>
    </div>
  );
}
