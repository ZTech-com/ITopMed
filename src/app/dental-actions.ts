"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { recordTooth } from "@/server/emr/dental";
import { requestMeta } from "@/server/http";

export async function toothAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug") ?? "");
  const ctx = await requireClinic(slug);
  const encounterId = String(fd.get("encounterId") ?? "");
  try {
    await recordTooth(ctx, encounterId, { tooth: fd.get("tooth"), condition: fd.get("condition"), surfaces: fd.getAll("surfaces").map(String) }, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/c/${slug}/encounters/${encounterId}`);
  return { ok: true, message: "dental.recorded", nonce: Date.now() };
}
