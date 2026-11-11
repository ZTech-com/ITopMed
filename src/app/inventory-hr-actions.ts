"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions-util";
import { requireClinic } from "@/server/auth/guards";
import { addCredential, archiveCredential, cancelLeave, recordLeave, saveStaffProfile } from "@/server/hr/hr";
import { requestMeta } from "@/server/http";
import { archiveItem, createItem, createSupplier, issueStock, receiveStock, recordCount, updateItem, writeOffStock } from "@/server/inventory/inventory";

async function clinicFrom(fd: FormData) {
  const slug = String(fd.get("$slug") ?? "");
  return { slug, ctx: await requireClinic(slug) };
}
const ok = (message: string, messageValues?: Record<string, string | number>): FormState => ({ ok: true, message, messageValues, nonce: Date.now() });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const fields = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, str(fd, k)]));

// ───────────── Inventory ─────────────

const ITEM_FIELDS = ["code", "name", "category", "form", "strength", "unit", "minStock", "barcode"];

export async function itemAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const itemId = str(fd, "itemId");
  let created: string | null = null;
  try {
    if (fd.get("op") === "archive") await archiveItem(ctx, itemId, await requestMeta());
    else if (itemId) await updateItem(ctx, itemId, fields(fd, ITEM_FIELDS), await requestMeta());
    else created = await createItem(ctx, fields(fd, ITEM_FIELDS), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  if (created) redirect(`/c/${slug}/inventory/${created}`);
  if (fd.get("op") === "archive") redirect(`/c/${slug}/inventory`);
  revalidatePath(`/c/${slug}/inventory`, "layout");
  return ok("clinic.inventory.saved");
}

export async function supplierAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    await createSupplier(ctx, fields(fd, ["name", "taxId", "phone"]), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/inventory/suppliers`);
  return ok("clinic.inventory.supplierAdded");
}

export async function stockAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const meta = await requestMeta();
  const itemId = str(fd, "itemId");
  let message = "clinic.inventory.saved";
  let values: Record<string, string | number> | undefined;
  try {
    switch (str(fd, "op")) {
      case "receive":
        await receiveStock(ctx, itemId, fields(fd, ["branchId", "lotNumber", "expiresOn", "quantity", "unitCost", "supplierId", "documentRef"]), meta);
        message = "clinic.inventory.received";
        break;
      case "issue": {
        const r = await issueStock(ctx, itemId, fields(fd, ["branchId", "quantity", "kind", "patientMrn", "departmentId"]), meta);
        message = "clinic.inventory.issued";
        values = { batches: r.batches };
        break;
      }
      case "writeOff":
        await writeOffStock(ctx, str(fd, "batchId"), fields(fd, ["quantity", "reason"]), meta);
        message = "clinic.inventory.writtenOff";
        break;
      case "count": {
        const r = await recordCount(ctx, str(fd, "batchId"), fields(fd, ["counted"]), meta);
        message = r.delta === 0 ? "clinic.inventory.countMatches" : "clinic.inventory.countAdjusted";
        values = { delta: r.delta > 0 ? `+${r.delta}` : String(r.delta) };
        break;
      }
      default:
        return { message: "errors.invalidInput", nonce: Date.now() };
    }
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/inventory`, "layout");
  return ok(message, values);
}

// ───────────── HR ─────────────

export async function hrProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  const membershipId = str(fd, "membershipId");
  try {
    await saveStaffProfile(ctx, membershipId, fields(fd, ["personnelNumber", "position", "departmentId", "employmentType", "hiredOn", "workPhone"]), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/hr`, "layout");
  return ok("clinic.hr.profileSaved");
}

export async function hrCredentialAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  try {
    if (fd.get("op") === "archive") await archiveCredential(ctx, str(fd, "credentialId"), await requestMeta());
    else await addCredential(ctx, str(fd, "membershipId"), fields(fd, ["kind", "title", "number", "issuer", "issuedOn", "expiresOn"]), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/hr`, "layout");
  return ok(fd.get("op") === "archive" ? "clinic.hr.credentialArchived" : "clinic.hr.credentialAdded");
}

export async function hrLeaveAction(_: FormState, fd: FormData): Promise<FormState> {
  const { slug, ctx } = await clinicFrom(fd);
  let conflicts = 0;
  try {
    if (fd.get("op") === "cancel") await cancelLeave(ctx, str(fd, "leaveId"), await requestMeta());
    else conflicts = (await recordLeave(ctx, str(fd, "membershipId"), fields(fd, ["kind", "startsOn", "endsOn"]), await requestMeta())).conflicts;
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/hr`, "layout");
  if (fd.get("op") === "cancel") return ok("clinic.hr.leaveCancelled");
  return conflicts > 0 ? { ok: true, message: "clinic.hr.leaveConflicts", messageValues: { count: conflicts }, nonce: Date.now() } : ok("clinic.hr.leaveRecorded");
}
