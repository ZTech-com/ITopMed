import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ServiceFields } from "@/components/service-form";
import { Form, SubmitButton } from "@/components/ui/form";
import { ButtonLink, Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { getService, listDepartments } from "@/server/clinic/resources";
import { serviceArchiveAction, updateServiceAction } from "../../../../workspace-actions";

export default async function EditServicePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "services.manage");
  const [t, service, departments] = await Promise.all([getTranslations(), getService(ctx, id), listDepartments(ctx)]);
  if (!service) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={t("clinic.services.title")}
        title={service.name}
        description={<span className="font-mono">{service.code}</span>}
        action={<ButtonLink href={`/c/${ctx.tenant.slug}/services`} variant="secondary">{t("clinic.services.back")}</ButtonLink>}
      />
      <Card>
        <CardBody>
          <Form action={updateServiceAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <input type="hidden" name="id" value={service.id} />
            <ServiceFields departments={departments} initial={service} />
            <div className="flex justify-end">
              <SubmitButton>{t("common.save")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>
      <Form action={serviceArchiveAction} className="mt-6">
        <input type="hidden" name="$slug" value={ctx.tenant.slug} />
        <input type="hidden" name="id" value={service.id} />
        <input type="hidden" name="archived" value={service.archivedAt ? "false" : "true"} />
        <SubmitButton variant="secondary">{service.archivedAt ? t("clinic.services.restore") : t("clinic.services.archive")}</SubmitButton>
      </Form>
    </div>
  );
}
