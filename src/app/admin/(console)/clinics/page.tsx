import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, STATUS_TONE, Table, Td, Th } from "@/components/ui/primitives";
import type { TenantStatus } from "@/generated/prisma/client";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { listTenants } from "@/server/tenancy/provisioning";
import { localizedName } from "@/lib/localized";

const STATUSES: TenantStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"];

export default async function ClinicsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const p = await requirePlatform("tenants.read");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const [t, format, locale, tenants] = await Promise.all([getTranslations(), getFormatter(), getLocale(), listTenants(p, { q, status })]);

  return (
    <>
      <PageHeader
        title={t("admin.clinics.title")}
        description={t("admin.clinics.subtitle")}
        action={
          platformCan(p.user.role, "tenants.create") ? (
            <ButtonLink href="/admin/clinics/new">
              <Plus aria-hidden className="size-4" />
              {t("admin.clinics.new")}
            </ButtonLink>
          ) : null
        }
      />

      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label className="relative flex-1">
          <span className="sr-only">{t("common.search")}</span>
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input
            name="q"
            defaultValue={q}
            placeholder={t("admin.clinics.searchPlaceholder")}
            className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface pl-10 pr-3 text-[15px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--focus)]"
          />
        </label>
        <label>
          <span className="sr-only">{t("common.status")}</span>
          <select name="status" defaultValue={status ?? ""} className="h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[15px] sm:w-48">
            <option value="">{t("admin.clinics.filterAll")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">{t("common.search")}</button>
      </form>

      <Card className="overflow-hidden">
        {tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={q || status ? t("common.noResults") : t("admin.clinics.empty")}
            description={q || status ? undefined : t("admin.clinics.emptyHint")}
          />
        ) : (
          <Table caption={t("admin.clinics.title")}>
            <thead>
              <tr>
                <Th>{t("admin.clinics.colName")}</Th>
                <Th>{t("admin.clinics.colStatus")}</Th>
                <Th>{t("admin.clinics.colPlan")}</Th>
                <Th className="text-right">{t("admin.clinics.colUsers")}</Th>
                <Th className="text-right">{t("admin.clinics.colBranches")}</Th>
                <Th>{t("admin.clinics.colCreated")}</Th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((x) => (
                <tr key={x.id} className="transition-colors hover:bg-surface-2">
                  <Td>
                    <Link href={`/admin/clinics/${x.id}`} className="font-medium hover:text-accent">
                      {x.name}
                    </Link>
                    <p className="font-mono text-[12px] text-text-3">/c/{x.slug}</p>
                    {x.network ? <p className="text-[12px] text-text-2">{x.network.name}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[x.status]}>{t(`status.${x.status}`)}</Badge>
                  </Td>
                  <Td className="text-text-2">{x.subscription ? localizedName(x.subscription.plan.name, locale) : "—"}</Td>
                  <Td label={t("admin.clinics.colUsers")} className="text-right tabular-nums">{format.number(x._count.memberships)}</Td>
                  <Td label={t("admin.clinics.colBranches")} className="text-right tabular-nums">{format.number(x._count.branches)}</Td>
                  <Td className="text-text-2">{format.dateTime(x.createdAt, { dateStyle: "medium" })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
