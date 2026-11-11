import { getTranslations } from "next-intl/server";
import { referenceRange } from "@/components/lab";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listLabTests } from "@/server/lab/lab";
import { analyteAction } from "../../../../lab-actions";

export default async function LabTestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "lab.manage");
  const [t, tests] = await Promise.all([getTranslations(), listLabTests(ctx)]);
  const s = ctx.tenant.slug;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("clinic.labTests.title")} description={t("clinic.labTests.subtitle")} />
      {tests.length === 0 ? <Alert tone="neutral">{t("clinic.labTests.noTests")}</Alert> : null}
      {tests.map((test) => (
        <Card key={test.id}>
          <CardHeader title={test.name} description={test.code} />
          {test.labAnalytes.length === 0 ? (
            <CardBody><p className="text-[14px] text-text-2">{t("clinic.labTests.noAnalytes")}</p></CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {test.labAnalytes.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-[14px]">
                  <span>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-text-2">
                      {" "}
                      · {a.unit} · {referenceRange(a.refLow, a.refHigh)}
                      {a.loinc ? ` · LOINC ${a.loinc}` : ""}
                    </span>
                  </span>
                  <Form action={analyteAction} className="space-y-0">
                    <input type="hidden" name="$slug" value={s} />
                    <input type="hidden" name="analyteId" value={a.id} />
                    <button name="op" value="archive" className={buttonClass("ghost", "sm")}>{t("clinic.labTests.archive")}</button>
                  </Form>
                </li>
              ))}
            </ul>
          )}
          <CardBody className="border-t border-border">
            <Form action={analyteAction}>
              <input type="hidden" name="$slug" value={s} />
              <input type="hidden" name="serviceId" value={test.id} />
              <div className="grid gap-3 sm:grid-cols-6">
                <TextField name="name" label={t("clinic.labTests.name")} required className="sm:col-span-2" />
                <TextField name="unit" label={t("clinic.labTests.unit")} required />
                <TextField name="refLow" label={t("clinic.labTests.refLow")} inputMode="decimal" optionalLabel={t("common.optional")} />
                <TextField name="refHigh" label={t("clinic.labTests.refHigh")} inputMode="decimal" optionalLabel={t("common.optional")} />
                <TextField name="loinc" label={t("clinic.labTests.loinc")} optionalLabel={t("common.optional")} />
              </div>
              <SubmitButton variant="secondary">{t("clinic.labTests.addAnalyte")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
