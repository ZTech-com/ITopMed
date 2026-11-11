import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, Card, EmptyState, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listClinicAudit } from "@/server/clinic/admin";

export default async function ClinicAuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "audit.read");
  const [t, format, events] = await Promise.all([getTranslations(), getFormatter(), listClinicAudit(ctx, 150)]);
  return (
    <>
      <PageHeader title={t("clinic.audit.title")} description={t("clinic.audit.subtitle")} />
      <Card className="overflow-hidden">
        {events.length === 0 ? (
          <EmptyState title={t("admin.audit.empty")} />
        ) : (
          <Table caption={t("clinic.audit.title")}>
            <thead>
              <tr>
                <Th>{t("admin.audit.colTime")}</Th>
                <Th>{t("admin.audit.colAction")}</Th>
                <Th>{t("admin.audit.colActor")}</Th>
                <Th>{t("admin.audit.colOutcome")}</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-text-2 tabular-nums">{format.dateTime(e.createdAt, { dateStyle: "short", timeStyle: "medium", timeZone: ctx.tenant.timezone })}</Td>
                  <Td className="font-mono text-[13px]">{e.action}</Td>
                  <Td className="font-mono text-[12px] text-text-2">{e.actorType === "PLATFORM_USER" ? "ITop Med" : e.actorType}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[e.outcome]}>{t(`status.${e.outcome}`)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
