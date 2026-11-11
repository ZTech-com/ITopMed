import { Building2, Clock, GitBranch, Mail, PauseCircle, ShieldCheck, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { platformDb } from "@/server/db";
import { platformOverview } from "@/server/tenancy/provisioning";

export default async function AdminDashboard() {
  const p = await requirePlatform("tenants.read");
  const [t, format, o] = await Promise.all([getTranslations(), getFormatter(), platformOverview(p)]);
  const recent = platformCan(p.user.role, "audit.read")
    ? await platformDb().auditEvent.findMany({ orderBy: { seq: "desc" }, take: 8, select: { id: true, action: true, outcome: true, createdAt: true, tenantId: true } })
    : [];

  return (
    <>
      <PageHeader
        title={t("admin.dashboard.title")}
        description={t("admin.dashboard.subtitle")}
        action={
          platformCan(p.user.role, "tenants.create") ? (
            <ButtonLink href="/admin/clinics/new">
              <Building2 aria-hidden className="size-4" />
              {t("admin.dashboard.newClinic")}
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat label={t("admin.dashboard.tenantsActive")} value={format.number(o.counts.ACTIVE ?? 0)} icon={<Building2 className="size-4" />} />
        <Stat label={t("admin.dashboard.tenantsTrial")} value={format.number(o.counts.TRIAL ?? 0)} icon={<Clock className="size-4" />} />
        <Stat label={t("admin.dashboard.tenantsSuspended")} value={format.number(o.counts.SUSPENDED ?? 0)} icon={<PauseCircle className="size-4" />} />
        <Stat label={t("admin.dashboard.activeUsers")} value={format.number(o.users)} icon={<Users className="size-4" />} />
        <Stat label={t("admin.dashboard.branches")} value={format.number(o.branches)} icon={<GitBranch className="size-4" />} />
        <Stat label={t("admin.dashboard.pendingInvites")} value={format.number(o.pendingInvites)} icon={<Mail className="size-4" />} />
      </div>

      <div className="mt-6">
        <Alert tone="neutral">
          <span className="inline-flex items-start gap-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("admin.dashboard.privacyNote")}
          </span>
        </Alert>
      </div>

      {platformCan(p.user.role, "audit.read") ? (
        <Card className="mt-6">
          <CardHeader title={t("admin.dashboard.recentActivity")} action={<ButtonLink href="/admin/audit" variant="ghost" size="sm">{t("nav.audit")}</ButtonLink>} />
          {recent.length === 0 ? (
            <EmptyState title={t("admin.audit.empty")} />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 px-6 py-3 text-[14px]">
                  <span className="min-w-0 truncate font-mono text-[13px]">{e.action}</span>
                  <span className="shrink-0 text-[13px] text-text-3">{format.relativeTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
