"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requestMeta } from "@/server/http";
import { completeFirstRun } from "@/server/local/first-run";

/**
 * First start of a fresh local installation. Public on purpose: there is no
 * account yet. completeFirstRun allows it only while the platform has no
 * accounts, only in LOCAL_MODE and only from this computer itself.
 */
export async function firstRunAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await completeFirstRun(Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  redirect("/login?welcome=1");
}
