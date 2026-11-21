import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PatientFields, patientName } from "@/components/patients";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { listBenefitCategories } from "@/server/clinic/pricing";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { requestMeta } from "@/server/http";
import { getPatient } from "@/server/patients/patients";
import { updatePatientAction } from "../../../../../care-actions";

export default async function EditPatientPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "patients.update");
  const [t, p, benefits] = await Promise.all([getTranslations(), getPatient(ctx, id, await requestMeta()), listBenefitCategories(ctx)]);
  if (!p) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader eyebrow={`${t("clinic.patients.title")} · ${p.mrn}`} title={patientName(p)} />
      <Form action={updatePatientAction} className="space-y-6">
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <input type="hidden" name="patientId" value={p.id} />
        <Card>
          <CardBody>
            <PatientFields
              initial={{
                ...p,
                pinfl: p.identifiers.find((i) => i.type === "PINFL")?.value,
                passport: p.identifiers.find((i) => i.type === "PASSPORT")?.value,
              }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <SelectField
              name="referralSource"
              label={t("clinic.desk.referral")}
              defaultValue={p.referralSource ?? ""}
              options={[{ value: "", label: "—" }, ...(["SELF", "DOCTOR", "ADVERTISING", "OTHER"] as const).map((r) => ({ value: r, label: t(`referralSource.${r}`) }))]}
            />
            <TextField name="referralDetail" label={t("clinic.desk.referralDetail")} defaultValue={p.referralDetail ?? ""} optionalLabel={t("common.optional")} />
            <SelectField name="benefitCategoryId" label={t("clinic.desk.benefit")} defaultValue={p.benefitCategoryId ?? ""} options={[{ value: "", label: t("clinic.desk.noBenefit") }, ...benefits.map((b) => ({ value: b.id, label: `${b.name} (−${b.discountPercent}%)` }))]} />
          </CardBody>
        </Card>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </Form>
    </div>
  );
}
