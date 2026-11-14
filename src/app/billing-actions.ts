"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { addInvoiceLine, createInvoice, issueInvoice, recordPayment, refundPayment, removeInvoiceLine, voidInvoice } from "@/server/billing/billing";
import { closeShift, createExpense, openShift, voidExpense } from "@/server/billing/cash";
import { requestMeta } from "@/server/http";

async function clinicFrom(fd: FormData) {
  const slug = String(fd.get("$slug") ?? "");
  return { slug, ctx: await requireClinic(slug) };
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const ok = (message: string, messageValues?: Record<string, string | number>): FormState => ({ ok: true, message, messageValues, nonce: Date.now() });

export async function createInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  let id: string;
  try {
    id = await createInvoice(ctx, { patientId: str(fd, "patientId"), branchId: str(fd, "branchId"), appointmentId: str(fd, "appointmentId") }, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  redirect(`/c/${slug}/billing/${id}`);
}

export async function invoiceLineAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const invoiceId = str(fd, "invoiceId");
  try {
    if (fd.get("op") === "remove") await removeInvoiceLine(ctx, str(fd, "lineId"), await requestMeta());
    else await addInvoiceLine(ctx, invoiceId, { serviceId: str(fd, "serviceId"), quantity: str(fd, "quantity") || "1", discount: str(fd, "discount"), discountReason: str(fd, "discountReason") }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/billing/${invoiceId}`);
  return { nonce: Date.now() };
}

export async function issueInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const invoiceId = str(fd, "invoiceId");
  try {
    const number = await issueInvoice(ctx, invoiceId, await requestMeta());
    revalidatePath(`/c/${slug}/billing`, "layout");
    return ok("clinic.billing.issued", { number });
  } catch (e) {
    return toFormState(e);
  }
}

export async function voidInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    await voidInvoice(ctx, str(fd, "invoiceId"), str(fd, "reason"), await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/c/${slug}/billing`, "layout");
  return ok("clinic.billing.voided");
}

export async function paymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const invoiceId = str(fd, "invoiceId");
  try {
    const r = await recordPayment(ctx, invoiceId, { amount: str(fd, "amount"), method: str(fd, "method"), externalRef: str(fd, "externalRef"), idempotencyKey: str(fd, "idempotencyKey") }, await requestMeta());
    revalidatePath(`/c/${slug}/billing`, "layout");
    return ok(r.duplicate ? "clinic.billing.duplicateIgnored" : "clinic.billing.paymentRecorded");
  } catch (e) {
    return toFormState(e, fd);
  }
}

export async function refundAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    await refundPayment(ctx, str(fd, "paymentId"), { amount: str(fd, "amount"), reason: str(fd, "reason"), idempotencyKey: str(fd, "idempotencyKey") }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/billing`, "layout");
  return ok("clinic.billing.refundRecorded");
}

export async function openShiftAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    await openShift(ctx, { branchId: str(fd, "branchId"), openingFloat: str(fd, "openingFloat") || "0", currency: str(fd, "currency") || "UZS" }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/cash`);
  return ok("clinic.cash.opened");
}

export async function closeShiftAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    await closeShift(ctx, str(fd, "shiftId"), str(fd, "counted"), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/cash`);
  return ok("clinic.cash.closed");
}

export async function expenseAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    if (fd.get("op") === "void") await voidExpense(ctx, str(fd, "expenseId"), await requestMeta());
    else
      await createExpense(
        ctx,
        { category: str(fd, "category"), amount: str(fd, "amount"), currency: str(fd, "currency"), spentOn: str(fd, "spentOn"), branchId: str(fd, "branchId"), description: str(fd, "description") },
        await requestMeta(),
      );
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/expenses`);
  return ok(fd.get("op") === "void" ? "clinic.expenses.voided" : "clinic.expenses.added");
}
