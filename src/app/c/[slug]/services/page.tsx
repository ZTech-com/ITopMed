import { Stethoscope } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ServiceFields } from "@/components/service-form";
import { Form, SubmitButton } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { minorToNumber } from "@/lib/money";
import { requireClinic } from "@/server/auth/guards";
import { listDepartments, listServices } from "@/server/clinic/resources";
import { createServiceAction } from "../../../workspace-actions";

export default async function ServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "services.read");
  const canManage = ctx.permissions.has("services.manage");
  const [t, format, services, departments] = await Promise.all([getTranslations(), getFormatter(), listServices(ctx, { includeArchived: canManage }), canManage ? listDepartments(ctx) : []]);

  return (
    <>
      <PageHeader title={t("clinic.services.title")} description={t("clinic.services.subtitle")} />
      <Card className="overflow-hidden">
        {services.length === 0 ? (
          <EmptyState icon={<Stethoscope className="size-6" />} title={t("clinic.services.empty")} description={t("clinic.services.emptyHint")} />
        ) : (
          <Table caption={t("clinic.services.title")}>
            <thead>
              <tr>
                <Th>{t("clinic.services.colService")}</Th>
                <Th>{t("clinic.services.colKind")}</Th>
                <Th className="text-right">{t("clinic.services.colDuration")}</Th>
                <Th className="text-right">{t("clinic.services.colPrice")}</Th>
                <Th className="text-right">{t("clinic.services.colDoctors")}</Th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className={s.archivedAt ? "opacity-60" : "hover:bg-surface-2"}>
                  <Td>
                    {canManage ? (
                      <Link href={`/c/${ctx.tenant.slug}/services/${s.id}`} className="font-medium hover:text-accent">
                        {s.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{s.name}</span>
                    )}
                    <p className="font-mono text-[12px] text-text-3">
                      {s.code}
                      {s.department ? ` · ${s.department.name}` : ""}
                    </p>
                    {s.archivedAt ? <Badge>{t("clinic.services.archivedBadge")}</Badge> : null}
                  </Td>
                  <Td className="text-text-2">{t(`serviceKind.${s.kind}`)}</Td>
                  <Td className="text-right tabular-nums text-text-2">{t("clinic.services.minutes", { count: s.durationMinutes })}</Td>
                  <Td className="text-right font-medium tabular-nums">{format.number(minorToNumber(s.priceMinor, s.currency), { style: "currency", currency: s.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 })}</Td>
                  <Td className="text-right tabular-nums">{s._count.doctors}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canManage ? (
        <Card className="mt-6">
          <CardHeader title={t("clinic.services.add")} />
          <CardBody>
            <Form action={createServiceAction}>
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <ServiceFields departments={departments} />
              <div className="flex justify-end">
                <SubmitButton>{t("clinic.services.add")}</SubmitButton>
              </div>
            </Form>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
