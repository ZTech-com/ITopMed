"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { requestMeta } from "@/server/http";
import { callNextPatient, createScreen, revokeScreen, saveCabinet } from "@/server/queue/board";
import { env } from "@/server/env";

const slugOf = (fd: FormData) => String(fd.get("$slug") ?? "");

/** Doctor: "Next patient" (or call the last one again). */
export async function callNextAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "emr.write");
  try {
    const r = await callNextPatient(ctx, await requestMeta(), { recall: fd.get("recall") === "1" });
    revalidatePath(`/c/${slugOf(fd)}/my-queue`);
    if (!r) return { ok: true, message: "clinic.call.nobody", nonce: Date.now() };
    return { ok: true, message: "clinic.call.called", messageValues: { number: r.queueNumber ?? "—" }, nonce: Date.now() };
  } catch (e) {
    return toFormState(e, fd);
  }
}

export async function cabinetAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "emr.write");
  try {
    await saveCabinet(ctx, { cabinet: fd.get("cabinet") }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slugOf(fd)}/my-queue`);
  return { ok: true, message: "clinic.call.cabinetSaved", nonce: Date.now() };
}

/** Settings: a new waiting-room screen. The link is shown once, here. */
export async function createScreenAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "clinic.settings.manage");
  try {
    const { token } = await createScreen(ctx, { branchId: fd.get("branchId"), name: fd.get("name"), voice: fd.get("voice") === "on" }, await requestMeta());
    revalidatePath(`/c/${slugOf(fd)}/settings`);
    return { ok: true, message: "clinic.screens.created", messageValues: { link: `${env().APP_URL.replace(/\/$/, "")}/tv/${token}` }, nonce: Date.now() };
  } catch (e) {
    return toFormState(e, fd);
  }
}

export async function revokeScreenAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireClinic(slugOf(fd), "clinic.settings.manage");
  try {
    await revokeScreen(ctx, String(fd.get("id")), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slugOf(fd)}/settings`);
  return { ok: true, message: "clinic.screens.revoked", nonce: Date.now() };
}
