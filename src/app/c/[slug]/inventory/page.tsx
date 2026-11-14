import { AlertTriangle, CalendarClock, PackageX, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, ButtonLink, Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { listOperationalBranches } from "@/server/clinic/context";
import { INVENTORY_CATEGORIES, INVENTORY_UNITS, listInventory } from "@/server/inventory/inventory";
import { DomainError } from "@/server/tenancy/provisioning";
import { notFound } from "next/navigation";
import { itemAction } from "../../../inventory-hr-actions";

export default async function InventoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ branch?: string; q?: string; filter?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug);
  if (!ctx.permissions.has("inventory.read") && !ctx.permissions.has("inventory.dispense")) notFound();
  const sp = await searchParams;
  const [t, format, branches] = await Promise.all([getTranslations(), getFormatter(), listOperationalBranches(ctx)]);
  const branchId = branches.find((b) => b.id === sp.branch)?.id ?? branches[0]?.id;
  const q = sp.q?.slice(0, 80);
  let items: Awaited<ReturnType<typeof listInventory>>;
  try {
    items = await listInventory(ctx, { branchId, q });
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const filter = sp.filter === "low" || sp.filter === "expiring" || sp.filter === "expired" ? sp.filter : null;
  const shown = items.filter((i) => (filter === "low" ? i.low : filter === "expiring" ? i.expiringSoon : filter === "expired" ? i.expired > 0 : true));
  const base = `/c/${ctx.tenant.slug}/inventory`;
  const canManage = ctx.permissions.has("inventory.manage");
  const link = (f: string | null) => `${base}?${new URLSearchParams({ ...(branchId ? { branch: branchId } : {}), ...(f ? { filter: f } : {}) }).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("clinic.inventory.title")}
        description={t("clinic.inventory.subtitle")}
        action={
          canManage ? (
            <ButtonLink href={`${base}/suppliers`} variant="secondary">
              <Truck aria-hidden className="size-4" />
              {t("clinic.inventory.suppliers")}
            </ButtonLink>
          ) : null
        }
      />

      <form className="flex flex-wrap items-end gap-3" action={base}>
        {branches.length > 1 ? (
          <label className="text-[13px] font-medium">
            {t("clinic.inventory.branch")}
            <select name="branch" defaultValue={branchId} className="mt-1 block h-10 rounded-[10px] border border-border-strong bg-surface px-3 text-[14px]">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : branchId ? (
          <input type="hidden" name="branch" value={branchId} />
        ) : null}
        <label className="min-w-[220px] flex-1 text-[13px] font-medium">
          {t("clinic.inventory.search")}
          <input name="q" defaultValue={q} placeholder={t("clinic.inventory.searchHint")} className="mt-1 block h-10 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[14px]" />
        </label>
        <button className="h-10 rounded-[10px] bg-sunken px-4 text-[14px] font-medium">{t("common.search")}</button>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href={link("low")} className="block">
          <Stat label={t("clinic.inventory.lowStock")} value={items.filter((i) => i.low).length} icon={<AlertTriangle aria-hidden className="size-4" />} />
        </Link>
        <Link href={link("expiring")} className="block">
          <Stat label={t("clinic.inventory.expiringSoon")} value={items.filter((i) => i.expiringSoon).length} icon={<CalendarClock aria-hidden className="size-4" />} />
        </Link>
        <Link href={link("expired")} className="block">
          <Stat label={t("clinic.inventory.expiredStock")} value={items.filter((i) => i.expired > 0).length} icon={<PackageX aria-hidden className="size-4" />} />
        </Link>
      </div>

      <Card>
        <CardHeader
          title={filter ? t(`clinic.inventory.filter.${filter}`) : t("clinic.inventory.items")}
          action={
            filter ? (
              <Link href={link(null)} className="text-[14px] font-medium text-accent hover:underline">
                {t("clinic.inventory.showAll")}
              </Link>
            ) : null
          }
        />
        {shown.length === 0 ? (
          <CardBody>
            <p className="text-[14px] text-text-2">{items.length === 0 && !q ? t("clinic.inventory.empty") : t("clinic.inventory.noMatches")}</p>
          </CardBody>
        ) : (
          <Table caption={t("clinic.inventory.items")}>
            <thead>
              <tr>
                <Th>{t("clinic.inventory.item")}</Th>
                <Th>{t("clinic.inventory.category")}</Th>
                <Th className="text-right">{t("clinic.inventory.onHand")}</Th>
                <Th className="text-right">{t("clinic.inventory.minStock")}</Th>
                <Th>{t("clinic.inventory.nextExpiry")}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="hover:bg-sunken">
                  <Td>
                    <Link href={`${base}/${i.id}${branchId ? `?branch=${branchId}` : ""}`} className="font-medium hover:underline">
                      {i.name}
                    </Link>
                    <p className="text-[12.5px] text-text-3">
                      <span className="font-mono">{i.code}</span>
                      {[i.form, i.strength].filter(Boolean).length ? ` · ${[i.form, i.strength].filter(Boolean).join(" ")}` : ""}
                    </p>
                  </Td>
                  <Td className="text-text-2">{t(`inventoryCategory.${i.category}`)}</Td>
                  <Td label={t("clinic.inventory.onHand")} className="text-right tabular-nums">
                    <span className={i.low ? "font-semibold text-danger" : "font-semibold"}>{i.onHand}</span> <span className="text-[12px] text-text-3">{t(`inventoryUnit.${i.unit}` as never)}</span>
                    {i.expired > 0 ? (
                      <p className="text-[12px] text-danger">{t("clinic.inventory.expiredQty", { count: i.expired })}</p>
                    ) : null}
                  </Td>
                  <Td label={t("clinic.inventory.minStock")} className="text-right tabular-nums text-text-2">{i.minStock || "—"}</Td>
                  <Td>
                    {i.nextExpiry ? (
                      <span className="flex items-center gap-2 tabular-nums">
                        {format.dateTime(i.nextExpiry, { dateStyle: "medium", timeZone: "UTC" })}
                        {i.expiringSoon ? <Badge tone="warning">{t("clinic.inventory.soon")}</Badge> : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("clinic.inventory.newItem")} description={t("clinic.inventory.newItemHint")} />
          <CardBody>
            <Form action={itemAction}>
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <div className="grid gap-3 sm:grid-cols-4">
                <TextField name="code" label={t("clinic.inventory.code")} required />
                <TextField name="name" label={t("clinic.inventory.name")} required className="sm:col-span-3" />
                <SelectField name="category" label={t("clinic.inventory.category")} options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: t(`inventoryCategory.${c}`) }))} />
                <TextField name="form" label={t("clinic.inventory.form")} optionalLabel={t("common.optional")} />
                <TextField name="strength" label={t("clinic.inventory.strength")} optionalLabel={t("common.optional")} />
                <SelectField name="unit" label={t("clinic.inventory.unit")} options={INVENTORY_UNITS.map((u) => ({ value: u, label: t(`inventoryUnit.${u}`) }))} />
                <TextField name="minStock" label={t("clinic.inventory.minStock")} hint={t("clinic.inventory.minStockHint")} inputMode="numeric" defaultValue="0" />
                <TextField name="barcode" label={t("clinic.inventory.barcode")} optionalLabel={t("common.optional")} />
              </div>
              <SubmitButton>
                <Plus aria-hidden className="size-4" />
                {t("clinic.inventory.create")}
              </SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
