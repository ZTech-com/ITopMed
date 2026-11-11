import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PatientFields, patientName } from "@/components/patients";
import { Form, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { requestMeta } from "@/server/http";
import { getPatient } from "@/server/patients/patients";
import { updatePatientAction } from "../../../../../care-actions";

export default async function EditPatientPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "patients.update");
  const [t, p] = await Promise.all([getTranslations(), getPatient(ctx, id, await requestMeta())]);
  if (!p) notFound();
  return (
    <div className="max-w-3xl">
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
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </Form>
    </div>
  );
}
