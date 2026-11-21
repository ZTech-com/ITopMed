import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, STATUS_TONE, buttonClass } from "@/components/ui/primitives";
import type { TenantStatus } from "@/generated/prisma/client";
import { localizedName } from "@/lib/localized";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { platformDb } from "@/server/db";
import { env } from "@/server/env";
import { MODULES } from "@/server/modules/catalog";
import { getTenantDetail } from "@/server/tenancy/provisioning";
import { clinicBotAction, recordPaymentAction, voidBillingEntryAction, moduleAction, planAction, supportRequestAction, tenantStatusAction } from "../../../actions";
import { clinicBotStatus } from "@/server/telegram/clinic-bot";
import { clinicActivity, clinicBillingDetail } from "@/server/platform/billing";
import { moneyFormatter } from "@/components/money";
import { effectiveStatus, listGrantsForPlatform } from "@/server/support/access";

const LIFECYCLE: Record<TenantStatus, ("activate" | "suspend" | "reactivate" | "archive")[]> = {
  PROVISIONING: [],
  TRIAL: ["activate", "suspend", "archive"],
  ACTIVE: ["suspend", "archive"],
  SUSPENDED: ["reactivate", "archive"],
  ARCHIVED: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function ClinicDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const p = await requirePlatform("tenants.read");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const [tenant, t, format, locale, plans] = await Promise.all([
    getTenantDetail(p, id),
    getTranslations(),
    getFormatter(),
    getLocale(),
    platformDb().plan.findMany({ where: { isActive: true } }),
  ]);
  if (!tenant) notFound();

  const role = p.user.role;
  const enabled = new Map(tenant.modules.map((m) => [m.moduleKey, m.enabled]));
  const actions = LIFECYCLE[tenant.status];
  const grants = await listGrantsForPlatform(p, tenant.id);
  const bot = await clinicBotStatus(p, tenant.id);
  const isSuper = role === "SUPER_ADMIN";
  const [billing, activityMap, money] = await Promise.all([isSuper ? clinicBillingDetail(p, tenant.id) : null, clinicActivity(), moneyFormatter()]);
  const activity = activityMap.get(tenant.id) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const canManage = platformCan(role, "tenants.manage");
  const appBase = env().APP_URL.replace(/\/$/, "");
  const url = `${env().APP_URL.replace(/\/$/, "")}/c/${tenant.slug}`;

  return (
    <>
      <PageHeader
        eyebrow={t("nav.clinics")}
        title={tenant.name}
        description={<span className="font-mono text-[14px]">{url}</span>}
        action={<Badge tone={STATUS_TONE[tenant.status]}>{t(`status.${tenant.status}`)}</Badge>}
      />

      {sp.created === "ready" ? (
        <div className="mb-6">
          <Alert tone="success" title={t("admin.clinicNew.createdReady")}>
            <span className="block">{t("admin.clinicNew.createdReadyHow")}</span>
            <span className="mt-1 block break-all font-mono text-[13px]">{env().APP_URL.replace(/\/$/, "")}/login</span>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t("admin.clinicDetail.workspace")} />
            <CardBody>
              <DescriptionList
                items={[
                  { label: t("admin.clinicNew.sectionType"), value: t(`practiceType.${tenant.practiceType}.name`) },
                  ...(tenant.network ? [{ label: t("admin.networks.network"), value: tenant.network.name }] : []),
                  { label: t("admin.clinicNew.legalName"), value: tenant.legalName ?? "—" },
                  { label: t("admin.clinicNew.taxId"), value: tenant.taxId ?? "—" },
                  { label: t("admin.clinicNew.contactPhone"), value: tenant.contactPhone ?? "—" },
                  { label: t("admin.clinicNew.defaultLocale"), value: tenant.defaultLocale },
                  { label: t("admin.clinicNew.timezone"), value: tenant.timezone },
                  { label: t("admin.clinicDetail.people"), value: format.number(tenant._count.memberships) },
                  { label: t("admin.clinicDetail.created"), value: format.dateTime(tenant.createdAt, { dateStyle: "medium", timeStyle: "short" }) },
                ]}
              />
            </CardBody>
          </Card>

          <Card id="billing">
            <CardHeader title={t("admin.billing.clinicTitle")} description={t("admin.billing.clinicHint")} />
            {billing ? (
              <CardBody className="space-y-5 text-[14px]">
                <DescriptionList
                  items={[
                    { label: t("admin.billing.invoiced"), value: money(billing.balance?.invoicedMinor ?? 0n, billing.balance?.currency ?? tenant.currency) },
                    { label: t("admin.billing.paid"), value: money(billing.balance?.paidMinor ?? 0n, billing.balance?.currency ?? tenant.currency) },
                    {
                      label: t("admin.control.debt"),
                      value:
                        billing.balance && billing.balance.debtMinor > 0n ? (
                          <span className={billing.balance.overdueDays > 0 ? "font-semibold text-danger" : "font-semibold"}>
                            {money(billing.balance.debtMinor, billing.balance.currency)}
                            {billing.balance.overdueDays > 0 ? ` · ${t("admin.billing.overdueBy", { days: billing.balance.overdueDays })}` : ""}
                          </span>
                        ) : (
                          t("admin.billing.noDebt")
                        ),
                    },
                  ]}
                />
                <Form action={recordPaymentAction} successMessage="admin.billing.paymentSaved">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <p className="font-medium">{t("admin.billing.recordPayment")}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <TextField name="amount" label={t("admin.billing.amount")} inputMode="decimal" required />
                    <SelectField
                      name="method"
                      label={t("admin.billing.method")}
                      defaultValue="TRANSFER"
                      options={(["TRANSFER", "CASH", "CARD", "OTHER"] as const).map((m) => ({ value: m, label: t(`admin.billing.methods.${m}`) }))}
                    />
                    <TextField name="receivedOn" type="date" label={t("admin.billing.receivedOn")} defaultValue={today} required />
                  </div>
                  <TextField name="note" label={t("admin.billing.note")} hint={t("admin.billing.noteHint")} />
                  <SubmitButton>{t("admin.billing.savePayment")}</SubmitButton>
                </Form>
                <div>
                  <p className="mb-2 font-medium">{t("admin.billing.invoices")}</p>
                  {billing.invoices.length === 0 ? (
                    <p className="text-text-2">{t("admin.billing.noInvoices")}</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-[var(--radius-control)] border border-border">
                      {billing.invoices.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block break-all font-mono text-[13px]">{i.number}</span>
                            <span className="text-[12px] text-text-3">{t("admin.billing.dueOn", { date: format.dateTime(i.dueDate, { dateStyle: "medium", timeZone: "UTC" }) })}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className={i.voidedAt ? "tabular-nums text-text-3 line-through" : "tabular-nums"}>{money(i.amountMinor, i.currency)}</span>
                            {!i.voidedAt ? <VoidForm kind="invoice" id={i.id} label={t("admin.billing.void")} confirm={t("admin.billing.voidConfirm")} /> : <Badge>{t("admin.billing.voidedBadge")}</Badge>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 font-medium">{t("admin.billing.payments")}</p>
                  {billing.payments.length === 0 ? (
                    <p className="text-text-2">{t("admin.billing.noPayments")}</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-[var(--radius-control)] border border-border">
                      {billing.payments.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block">
                              {format.dateTime(x.receivedOn, { dateStyle: "medium", timeZone: "UTC" })} · {t(`admin.billing.methods.${x.method}`)}
                            </span>
                            {x.note ? <span className="block break-words text-[12px] text-text-3">{x.note}</span> : null}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className={x.voidedAt ? "tabular-nums text-text-3 line-through" : "tabular-nums"}>{money(x.amountMinor, x.currency)}</span>
                            {!x.voidedAt ? <VoidForm kind="payment" id={x.id} label={t("admin.billing.void")} confirm={t("admin.billing.voidConfirm")} /> : <Badge>{t("admin.billing.voidedBadge")}</Badge>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            ) : (
              <CardBody>
                <p className="text-[14px] text-text-2">{t("admin.billing.superOnly")}</p>
              </CardBody>
            )}
          </Card>

          <Card id="activity">
            <CardHeader title={t("admin.control.activityTitle")} description={t("admin.control.activityHint")} />
            <CardBody>
              <DescriptionList
                items={[
                  { label: t("admin.control.lastActivity"), value: activity?.lastLoginAt ? format.relativeTime(new Date(activity.lastLoginAt)) : t("common.never") },
                  { label: t("admin.control.staffNow"), value: t("admin.control.staffValue", { d7: activity?.staff7d ?? 0, d30: activity?.staff30d ?? 0, all: activity?.activeStaff ?? 0 }) },
                  { label: t("admin.control.visitsToday"), value: format.number(activity?.appointmentsToday ?? 0) },
                  { label: t("admin.control.visits30d"), value: format.number(activity?.appointments30d ?? 0) },
                  { label: t("admin.control.patients30d"), value: format.number(activity?.newPatients30d ?? 0) },
                  { label: t("admin.control.invoices30d"), value: format.number(activity?.invoices30d ?? 0) },
                ]}
              />
            </CardBody>
          </Card>

          <Card id="telegram-bot">
            <CardHeader title={t("admin.clinicBot.title")} description={t("admin.clinicBot.hint")} />
            <CardBody className="space-y-4 text-[14px]">
              {bot ? (
                <DescriptionList
                  items={[
                    { label: t("admin.clinicBot.bot"), value: <span className="font-medium">@{bot.username}</span> },
                    { label: t("admin.clinicBot.connectedAt"), value: format.dateTime(bot.connectedAt, { dateStyle: "medium", timeStyle: "short" }) },
                    { label: t("admin.clinicBot.miniApp"), value: <span className="break-all font-mono text-[13px]">{appBase}/tg/{tenant.slug}</span> },
                    { label: t("admin.clinicBot.loginPage"), value: <span className="break-all font-mono text-[13px]">{appBase}/login/{tenant.slug}</span> },
                  ]}
                />
              ) : (
                <p className="text-text-2">{t("admin.clinicBot.none")}</p>
              )}
              {canManage ? (
                <Form action={clinicBotAction} successMessage="admin.clinicBot.saved">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <ol className="list-decimal space-y-1 pl-5 text-text-2">
                    <li>{t("admin.clinicBot.step1")}</li>
                    <li>{t("admin.clinicBot.step3")}</li>
                  </ol>
                  <TextField name="token" type="password" label={t("admin.clinicBot.token")} hint={t("admin.clinicBot.tokenHint")} autoComplete="off" required />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton>{bot ? t("admin.clinicBot.replace") : t("admin.clinicBot.connect")}</SubmitButton>
                  </div>
                </Form>
              ) : null}
              {canManage && bot ? (
                <Form action={clinicBotAction} successMessage="admin.clinicBot.removed">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <input type="hidden" name="op" value="disconnect" />
                  <SubmitButton variant="danger">{t("admin.clinicBot.disconnect")}</SubmitButton>
                </Form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("admin.clinicDetail.modules")} description={t("admin.clinicDetail.modulesHint")} />
            <ul className="divide-y divide-border">
              {MODULES.map((m) => {
                const on = m.core || enabled.get(m.key) === true;
                return (
                  <li key={m.key} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[14px] font-medium">{t(`modules.${m.key}`)}</span>
                      {m.status === "planned" ? <Badge>{t("common.planned")}</Badge> : null}
                    </div>
                    {m.core ? (
                      <span className="text-[13px] text-text-3">{t("admin.clinicDetail.alwaysOn")}</span>
                    ) : platformCan(role, "modules.manage") ? (
                      <form action={moduleAction}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="moduleKey" value={m.key} />
                        <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                        <button className={buttonClass(on ? "secondary" : "primary", "sm")} aria-pressed={on}>
                          {on ? t("admin.clinicDetail.disable") : t("admin.clinicDetail.enable")}
                        </button>
                      </form>
                    ) : (
                      <Badge tone={on ? "success" : "neutral"}>{on ? t("common.yes") : t("common.no")}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("admin.clinicDetail.subscription")} />
            <CardBody className="space-y-4">
              {tenant.subscription ? (
                <DescriptionList
                  items={[
                    { label: t("admin.clinicDetail.plan"), value: localizedName(tenant.subscription.plan.name, locale) },
                    { label: t("common.status"), value: <Badge tone={STATUS_TONE[tenant.subscription.status]}>{t(`status.${tenant.subscription.status}`)}</Badge> },
                    ...(tenant.subscription.trialEndsAt ? [{ label: t("admin.clinicDetail.trialEnds"), value: format.dateTime(tenant.subscription.trialEndsAt, { dateStyle: "medium" }) }] : []),
                  ]}
                />
              ) : null}
              {platformCan(role, "subscriptions.manage") && tenant.subscription ? (
                <Form action={planAction} className="space-y-3 border-t border-border pt-4">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <SelectField name="planCode" label={t("admin.clinicDetail.changePlan")} defaultValue={tenant.subscription.plan.code} options={plans.map((pl) => ({ value: pl.code, label: localizedName(pl.name, locale) }))} />
                  <SubmitButton variant="secondary" full>{t("common.save")}</SubmitButton>
                </Form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("admin.clinicDetail.branches")} />
            <ul className="divide-y divide-border">
              {tenant.branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-6 py-3 text-[14px]">
                  <span className="truncate">{b.name}</span>
                  {b.isMain ? <Badge tone="accent">{t("admin.clinicDetail.main")}</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title={t("admin.support.title")} description={t("admin.support.hint")} />
            <CardBody className="space-y-4">
              {grants.length === 0 ? (
                <p className="text-[14px] text-text-2">{t("admin.support.none")}</p>
              ) : (
                <ul className="space-y-2">
                  {grants.map((g) => {
                    const st = effectiveStatus(g);
                    return (
                      <li key={g.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0 truncate">
                          {t(`supportScope.${g.scope}`)} · {g.requesterName}
                        </span>
                        <Badge tone={STATUS_TONE[st]}>{t(`status.${st}`)}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
              {platformCan(role, "support.request_access") && tenant.status !== "ARCHIVED" ? (
                <Form action={supportRequestAction} className="space-y-3 border-t border-border pt-4">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <SelectField name="scope" label={t("admin.support.scope")} options={(["CONFIGURATION", "OPERATIONAL"] as const).map((s) => ({ value: s, label: t(`supportScope.${s}`) }))} />
                  <TextField name="durationMinutes" label={t("admin.support.duration")} inputMode="numeric" defaultValue="30" />
                  <TextField name="reason" label={t("admin.support.reason")} required />
                  <TextField name="ticketRef" label={t("admin.support.ticketRef")} optionalLabel={t("common.optional")} />
                  <SubmitButton variant="secondary" full>{t("admin.support.request")}</SubmitButton>
                </Form>
              ) : null}
            </CardBody>
          </Card>

          {platformCan(role, "tenants.lifecycle") && actions.length > 0 ? (
            <Card>
              <CardHeader title={t("admin.clinicDetail.lifecycle")} description={t("admin.clinicDetail.lifecycleHint")} />
              <CardBody>
                <Form action={tenantStatusAction}>
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <SelectField name="lifecycle" label={t("common.actions")} options={actions.map((a) => ({ value: a, label: t(`admin.clinicDetail.${a}`) }))} />
                  <TextField name="reason" label={t("admin.clinicDetail.reason")} hint={t("admin.clinicDetail.reasonHint")} />
                  <SubmitButton variant="secondary" full>{t("common.confirm")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Voids an invoice or a payment after an explicit confirmation (never deletes: the record stays, struck through). */
function VoidForm({ kind, id, label, confirm }: { kind: "invoice" | "payment"; id: string; label: string; confirm: string }) {
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-danger">{label}</summary>
      <Form action={voidBillingEntryAction} className="mt-2 space-y-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>{confirm}</span>
        </label>
        <SubmitButton variant="danger">{label}</SubmitButton>
      </Form>
    </details>
  );
}
