"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { completeSetup, setClinicModule } from "@/server/clinic/practice";
import { requestMeta } from "@/server/http";

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug") ?? "");
  const ctx = await requireClinic(slug);
  const on = (k: string) => fd.get(k) === "on";
  try {
    await completeSetup(
      ctx,
      {
        practiceType: String(fd.get("practiceType") ?? ""),
        applyModules: on("applyModules"),
        addStarterServices: on("addStarterServices"),
        ownerIsDoctor: on("ownerIsDoctor"),
        ownerFrontDesk: on("ownerFrontDesk"),
        specialty: String(fd.get("specialty") ?? ""),
        focusSpecialty: String(fd.get("focusSpecialty") ?? ""),
        weekdaySchedule: on("weekdaySchedule"),
      },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}`, "layout");
  redirect(`/c/${slug}?setup=done`);
}

export async function moduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug") ?? "");
  const ctx = await requireClinic(slug);
  const enabled = fd.get("op") === "on";
  try {
    await setClinicModule(ctx, String(fd.get("module") ?? ""), enabled, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/c/${slug}`, "layout");
  return { ok: true, message: enabled ? "clinic.modules.enabled" : "clinic.modules.disabled", nonce: Date.now() };
}
