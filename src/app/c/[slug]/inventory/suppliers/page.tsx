import { getTranslations } from "next-intl/server";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listSuppliers } from "@/server/inventory/inventory";
import { supplierAction } from "../../../../inventory-hr-actions";

export default async function SuppliersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "inventory.manage");
  const [t, suppliers] = await Promise.all([getTranslations(), listSuppliers(ctx)]);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow={t("clinic.inventory.title")} title={t("clinic.inventory.suppliers")} description={t("clinic.inventory.suppliersHint")} />
      <Card>
        {suppliers.length === 0 ? (
          <CardBody>
            <p className="text-[14px] text-text-2">{t("clinic.inventory.noSuppliers")}</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {suppliers.map((x) => (
              <li key={x.id} className="px-6 py-3 text-[14px]">
                <p className="font-medium">{x.name}</p>
                <p className="text-[12.5px] text-text-3">{[x.taxId ? `${t("clinic.inventory.taxId")} ${x.taxId}` : null, x.phone].filter(Boolean).join(" · ") || "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("clinic.inventory.addSupplier")} />
        <CardBody>
          <Form action={supplierAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField name="name" label={t("clinic.inventory.supplierName")} required />
              <TextField name="taxId" label={t("clinic.inventory.taxId")} inputMode="numeric" optionalLabel={t("common.optional")} />
              <TextField name="phone" type="tel" label={t("clinic.inventory.phone")} optionalLabel={t("common.optional")} />
            </div>
            <SubmitButton>{t("clinic.inventory.addSupplier")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
