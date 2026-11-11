import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { myShifts } from "@/server/billing/cash";
import { listOperationalBranches } from "@/server/clinic/context";
import { closeShiftAction, openShiftAction } from "../../../billing-actions";

export default async function CashPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "cash.shift");
  const [t, format, money, shifts, branches] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), myShifts(ctx), listOperationalBranches(ctx)]);
  const tz = ctx.tenant.timezone;
  const open = shifts.filter((s) => s.status === "OPEN");
  const closed = shifts.filter((s) => s.status === "CLOSED");
  const openBranches = new Set(open.map((s) => s.branchId));
  const free = branches.filter((b) => !openBranches.has(b.id));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("clinic.cash.title")} description={t("clinic.cash.subtitle")} />

      {open.map((s) => (
        <Card key={s.id}>
          <CardHeader title={`${t("clinic.cash.current")} · ${s.branch.name}`} action={<Badge tone="success">{t("status.OPEN")}</Badge>} />
          <CardBody className="space-y-5">
            <DescriptionList
              items={[
                { label: t("clinic.cash.openedAt"), value: format.dateTime(s.openedAt, { dateStyle: "medium", timeStyle: "short", timeZone: tz }) },
                { label: t("clinic.cash.openingFloat"), value: money(s.openingFloatMinor, s.currency) },
                { label: t("clinic.cash.cashIn"), value: money(s.live!.cashIn, s.currency) },
                { label: t("clinic.cash.cashOut"), value: money(s.live!.cashOut, s.currency) },
                { label: t("clinic.cash.expected"), value: <span className="text-[18px] font-semibold">{money(s.live!.expected, s.currency)}</span> },
              ]}
            />
            <Form action={closeShiftAction} className="border-t border-border pt-4">
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <input type="hidden" name="shiftId" value={s.id} />
              <TextField name="counted" label={t("clinic.cash.counted")} inputMode="numeric" required />
              <SubmitButton variant="secondary">{t("clinic.cash.close")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ))}

      {open.length === 0 ? <p className="text-[14px] text-text-2">{t("clinic.cash.noShift")}</p> : null}

      {free.length > 0 ? (
        <Card>
          <CardHeader title={t("clinic.cash.open")} />
          <CardBody>
            <Form action={openShiftAction}>
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField name="branchId" label={t("clinic.cash.branch")} options={free.map((b) => ({ value: b.id, label: b.name }))} />
                <TextField name="openingFloat" label={t("clinic.cash.openingFloat")} inputMode="numeric" defaultValue="0" />
                <SelectField name="currency" label={t("clinic.cash.currency")} defaultValue={ctx.tenant.currency} options={[{ value: "UZS", label: "UZS" }, { value: "USD", label: "USD" }]} />
              </div>
              <SubmitButton>{t("clinic.cash.open")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : null}

      {closed.length > 0 ? (
        <Card>
          <CardHeader title={t("clinic.cash.history")} />
          <ul className="divide-y divide-border">
            {closed.map((s) => {
              const diff = s.differenceMinor ?? 0n;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-[14px]">
                  <div>
                    <p className="font-medium">{s.branch.name}</p>
                    <p className="text-[12.5px] text-text-3">
                      {format.dateTime(s.openedAt, { dateStyle: "short", timeStyle: "short", timeZone: tz })} → {s.closedAt ? format.dateTime(s.closedAt, { timeStyle: "short", timeZone: tz }) : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums">
                      {t("clinic.cash.expected")}: {money(s.expectedCashMinor ?? 0n, s.currency)} · {t("clinic.cash.counted")}: {money(s.countedCashMinor ?? 0n, s.currency)}
                    </p>
                    <Badge tone={diff === 0n ? "success" : diff < 0n ? "danger" : "warning"}>
                      {diff === 0n ? t("clinic.cash.balanced") : `${diff < 0n ? t("clinic.cash.shortage") : t("clinic.cash.surplus")} ${money(diff < 0n ? -diff : diff, s.currency)}`}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
