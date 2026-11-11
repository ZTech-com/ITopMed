import { getTranslations } from "next-intl/server";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listBranches } from "@/server/clinic/admin";
import { createBranchAction } from "../../../clinic-actions";

export default async function BranchesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "clinic.settings.read");
  const [t, branches] = await Promise.all([getTranslations(), listBranches(ctx)]);
  const optional = t("common.optional");
  return (
    <>
      <PageHeader title={t("clinic.branches.title")} description={t("clinic.branches.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <ul className="divide-y divide-border">
            {branches.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <p className="font-medium">{b.name}</p>
                  {b.address || b.phone ? <p className="mt-0.5 text-[13px] text-text-2">{[b.address, b.phone].filter(Boolean).join(" · ")}</p> : null}
                </div>
                {b.isMain ? <Badge tone="accent">{t("clinic.branches.main")}</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        {ctx.permissions.has("clinic.branches.manage") ? (
          <Card className="lg:col-span-2">
            <CardHeader title={t("clinic.branches.add")} />
            <CardBody>
              <Form action={createBranchAction}>
                <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                <TextField name="name" label={t("clinic.branches.name")} required />
                <TextField name="address" label={t("clinic.branches.address")} optionalLabel={optional} />
                <TextField name="phone" type="tel" label={t("clinic.branches.phone")} optionalLabel={optional} inputMode="tel" />
                <SubmitButton full>{t("clinic.branches.add")}</SubmitButton>
              </Form>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
