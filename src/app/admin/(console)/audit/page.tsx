import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SubmitButton } from "@/components/ui/form";
import { Badge, Card, EmptyState, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import { requirePlatform } from "@/server/auth/guards";
import { platformDb } from "@/server/db";
import { verifyAuditAction } from "../../actions";

export default async function AuditPage() {
  await requirePlatform("audit.read");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const db = platformDb();
  const events = await db.auditEvent.findMany({ orderBy: { seq: "desc" }, take: 150 });
  const tenantIds = [...new Set(events.map((e) => e.tenantId).filter((x): x is string => Boolean(x)))];
  const actorIds = [...new Set(events.filter((e) => e.actorType === "PLATFORM_USER" && e.actorId).map((e) => e.actorId!))];
  const [tenants, actors] = await Promise.all([
    db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }),
    db.platformUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }),
  ]);
  const tenantName = new Map(tenants.map((x) => [x.id, x.name]));
  const actorName = new Map(actors.map((x) => [x.id, x.fullName]));

  return (
    <>
      <PageHeader
        title={t("admin.audit.title")}
        description={t("admin.audit.subtitle")}
        action={
          <Form action={verifyAuditAction} className="flex flex-col items-end gap-2 space-y-0">
            <SubmitButton variant="secondary">{t("admin.audit.verify")}</SubmitButton>
          </Form>
        }
      />
      <Card className="overflow-hidden">
        {events.length === 0 ? (
          <EmptyState title={t("admin.audit.empty")} />
        ) : (
          <Table caption={t("admin.audit.title")}>
            <thead>
              <tr>
                <Th>{t("admin.audit.colTime")}</Th>
                <Th>{t("admin.audit.colAction")}</Th>
                <Th>{t("admin.audit.colActor")}</Th>
                <Th>{t("admin.audit.colClinic")}</Th>
                <Th>{t("admin.audit.colOutcome")}</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-text-2 tabular-nums">{format.dateTime(e.createdAt, { dateStyle: "short", timeStyle: "medium" })}</Td>
                  <Td className="font-mono text-[13px]">{e.action}</Td>
                  <Td className="text-text-2">
                    {e.actorType === "PLATFORM_USER" && e.actorId ? (actorName.get(e.actorId) ?? e.actorType) : <span className="font-mono text-[12px]">{e.actorType}{e.actorId ? ` · ${e.actorId.slice(-8)}` : ""}</span>}
                  </Td>
                  <Td className="text-text-2">{e.tenantId ? (tenantName.get(e.tenantId) ?? "—") : t("admin.audit.platform")}</Td>
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
