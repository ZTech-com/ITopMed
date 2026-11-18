"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { archiveBenefitCategory, archivePackage, saveBenefitCategory, saveFreeFollowUpDays, savePackage } from "@/server/clinic/pricing";
import { requestMeta } from "@/server/http";

const slugOf = (fd: FormData) => String(fd.get("$slug") ?? "");

async function done(fd: FormData, work: () => Promise<void>, message: string): Promise<FormState> {
  try {
    await work();
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slugOf(fd)}/services/discounts`);
  return { ok: true, message, nonce: Date.now() };
}

export async function benefitAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "services.manage");
  return done(fd, async () => saveBenefitCategory(ctx, { name: fd.get("name"), discountPercent: fd.get("discountPercent") }, await requestMeta()), "clinic.pricing.saved");
}

export async function archiveBenefitAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "services.manage");
  return done(fd, async () => archiveBenefitCategory(ctx, String(fd.get("id")), await requestMeta()), "clinic.pricing.archived");
}

export async function packageAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "services.manage");
  return done(fd, async () => savePackage(ctx, { name: fd.get("name"), discountPercent: fd.get("discountPercent"), serviceIds: fd.getAll("serviceIds") }, await requestMeta()), "clinic.pricing.saved");
}

export async function archivePackageAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "services.manage");
  return done(fd, async () => archivePackage(ctx, String(fd.get("id")), await requestMeta()), "clinic.pricing.archived");
}

export async function followUpAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "clinic.settings.manage");
  return done(fd, async () => saveFreeFollowUpDays(ctx, { freeFollowUpDays: fd.get("freeFollowUpDays") }, await requestMeta()), "clinic.pricing.saved");
}
