import { getFormatter, getTranslations } from "next-intl/server";
import { moneyFormatter } from "@/components/money";
import { Form, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { EXPENSE_CATEGORIES, listExpenses } from "@/server/billing/cash";
import { listOperationalBranches } from "@/server/clinic/context";
import { addDays, isLocalDate, todayIn } from "@/server/scheduling/time";
import { expenseAction } from "../../../billing-actions";

export default async function ExpensesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug, "finance.manage");
  const sp = await searchParams;
  const today = todayIn(ctx.tenant.timezone);
  const to = isLocalDate(sp.to) ? sp.to : today;
  const from = isLocalDate(sp.from) && sp.from <= to ? sp.from : addDays(to, -30);
  const [t, format, money, expenses, branches] = await Promise.all([getTranslations(), getFormatter(), moneyFormatter(), listExpenses(ctx, from, to), listOperationalBranches(ctx)]);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={t("clinic.expenses.title")} description={t("clinic.expenses.subtitle")} />
      <Card>
        <CardHeader title={t("clinic.expenses.add")} />
        <CardBody>
          <Form action={expenseAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <div className="grid gap-3 sm:grid-cols-4">
              <SelectField name="category" label={t("clinic.expenses.category")} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`expenseCategory.${c}`) }))} />
              <TextField name="amount" label={t("clinic.expenses.amount")} inputMode="numeric" required />
              <SelectField name="currency" label={t("clinic.expenses.currency")} defaultValue={ctx.tenant.currency} options={[{ value: "UZS", label: "UZS" }, { value: "USD", label: "USD" }]} />
              <TextField name="spentOn" type="date" label={t("clinic.expenses.date")} defaultValue={today} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="branchId" label={t("clinic.expenses.branch")} defaultValue="" options={[{ value: "", label: t("clinic.expenses.allBranches") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              <TextField name="description" label={t("clinic.expenses.description")} hint={t("clinic.expenses.descriptionHint")} optionalLabel={t("common.optional")} />
            </div>
            <SubmitButton>{t("clinic.expenses.add")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`${format.dateTime(new Date(`${from}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })} — ${format.dateTime(new Date(`${to}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}`} />
        {expenses.length === 0 ? (
          <CardBody><p className="text-[14px] text-text-2">{t("clinic.expenses.empty")}</p></CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {expenses.map((e) => (
              <li key={e.id} className={`flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-[14px] ${e.voidedAt ? "opacity-50 line-through" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium">{t(`expenseCategory.${e.category}`)}</p>
                  <p className="text-[12.5px] text-text-3">
                    {format.dateTime(e.spentOn, { dateStyle: "medium", timeZone: "UTC" })} · {e.branch?.name ?? t("clinic.expenses.allBranches")}
                    {e.description ? ` · ${e.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{money(e.amountMinor, e.currency)}</span>
                  {!e.voidedAt ? (
                    <Form action={expenseAction} className="space-y-0">
                      <input type="hidden" name="$slug" value={ctx.tenant.slug} />
                      <input type="hidden" name="expenseId" value={e.id} />
                      <button name="op" value="void" className={buttonClass("ghost", "sm")}>{t("clinic.expenses.void")}</button>
                    </Form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
