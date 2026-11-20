"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { FormState } from "@/lib/form-state";
import { loginSchema } from "@/lib/validation";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { toFormState } from "@/server/actions-util";
import { clearAdminCookie, readAdminToken, setAdminSessionCookie } from "@/server/auth/cookies";
import { requirePlatform } from "@/server/auth/guards";
import { loginPlatformUser, logoutPlatform, unlinkPlatformTelegram, validatePlatformSession } from "@/server/auth/platform-auth";
import { createNetwork, setTenantNetwork } from "@/server/platform/networks";
import { connectClinicBot, disconnectClinicBot } from "@/server/telegram/clinic-bot";
import { generateMonthlyInvoices, recordClinicPayment, suspendOverdueClinics, updateBillingSettings, voidClinicInvoice, voidClinicPayment } from "@/server/platform/billing";
import {
  acceptPlatformInvitation,
  createPlatformAccount,
  invitePlatformStaff,
  resendPlatformInvitation,
  revokePlatformInvitation,
} from "@/server/platform/staff";
import { platformDb } from "@/server/db";
import { requestMeta } from "@/server/http";
import { requestSupportAccess } from "@/server/support/access";
import {
  changeSubscriptionPlan,
  changeTenantStatus,
  createClinicWithOwner,
  resendInvitation,
  revokeInvitation,
  setTenantModule,
  type LifecycleAction,
} from "@/server/tenancy/provisioning";

// ───────────── Authentication ─────────────

export async function adminLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ username: fd.get("username"), password: fd.get("password") });
  if (!parsed.success) return { message: "auth.invalid", values: { username: String(fd.get("username") ?? "") } };
  const r = await loginPlatformUser(parsed.data.username, parsed.data.password, await requestMeta());
  if (!r.ok) return { message: `auth.${r.reason === "rate_limited" ? "rateLimited" : r.reason}`, values: { username: parsed.data.username } };
  // The console is the SuperAdmin's alone: other platform accounts are signed straight out again.
  const p = await validatePlatformSession(r.token);
  if (p?.user.role !== "SUPER_ADMIN") {
    await logoutPlatform(r.token);
    return { message: "auth.consoleSuperOnly", values: { username: parsed.data.username } };
  }
  await setAdminSessionCookie(r.token);
  if (isLocale(r.locale)) (await cookies()).set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  redirect("/admin");
}

/** Removes the Telegram sign-in from the employee's own account. */
export async function adminUnlinkTelegramAction(): Promise<FormState> {
  const actor = await requirePlatform();
  await unlinkPlatformTelegram(actor, await requestMeta());
  revalidatePath("/admin/security");
  return { ok: true, message: "security.telegramUnlinked", nonce: Date.now() };
}

export async function adminLogoutAction() {
  await logoutPlatform(await readAdminToken());
  await clearAdminCookie();
  redirect("/admin/login");
}

// ───────────── Clinics ─────────────

export async function createClinicAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("tenants.create");
  let result: Awaited<ReturnType<typeof createClinicWithOwner>>;
  try {
    result = await createClinicWithOwner(actor, Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath("/admin/clinics");
  // The password is never put in the URL: the admin typed or copied it on the form.
  const created = result.owner === "password" ? "ready" : result.owner === "existing_account" ? "existing" : result.invitationDelivered ? "1" : "nomail";
  redirect(`/admin/clinics/${result.tenantId}?created=${created}`);
}

export async function tenantStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("tenants.lifecycle");
  const tenantId = String(fd.get("tenantId"));
  const action = String(fd.get("lifecycle")) as LifecycleAction;
  if (!["activate", "suspend", "reactivate", "archive"].includes(action)) return { message: "errors.invalidInput" };
  try {
    await changeTenantStatus(actor, tenantId, action, String(fd.get("reason") ?? ""), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  return { ok: true, message: "admin.clinicDetail.statusChanged", nonce: Date.now() };
}

export async function moduleAction(fd: FormData) {
  const actor = await requirePlatform("modules.manage");
  const tenantId = String(fd.get("tenantId"));
  await setTenantModule(actor, tenantId, String(fd.get("moduleKey")), fd.get("enabled") === "true", await requestMeta());
  revalidatePath(`/admin/clinics/${tenantId}`);
}

export async function planAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("subscriptions.manage");
  const tenantId = String(fd.get("tenantId"));
  try {
    await changeSubscriptionPlan(actor, tenantId, String(fd.get("planCode")), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  return { ok: true, message: "admin.clinicDetail.saved", nonce: Date.now() };
}

export async function invitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("tenants.manage");
  const id = String(fd.get("invitationId"));
  const op = String(fd.get("op"));
  try {
    if (op === "resend") {
      const r = await resendInvitation(actor, id, await requestMeta());
      if (!r.delivered) return { message: "admin.clinicNew.createdNoEmail", nonce: Date.now() };
    } else if (op === "revoke") await revokeInvitation(actor, id, await requestMeta());
    else return { message: "errors.invalidInput" };
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admin/clinics/${String(fd.get("tenantId"))}`);
  return { ok: true, message: op === "resend" ? "admin.clinicDetail.resent" : "admin.clinicDetail.revoked", nonce: Date.now() };
}

/** The clinic's own Telegram bot (notifications, Mini App, website sign-in). Tokens are never echoed back. */
export async function clinicBotAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("tenants.manage");
  const tenantId = String(fd.get("tenantId") ?? "");
  try {
    if (fd.get("op") === "disconnect") await disconnectClinicBot(actor, tenantId, await requestMeta());
    else await connectClinicBot(actor, tenantId, { token: fd.get("token") }, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  return { ok: true, nonce: Date.now() };
}

// ───────────── Billing of clinics (SuperAdmin) ─────────────

export async function recordPaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("subscriptions.manage");
  const tenantId = String(fd.get("tenantId") ?? "");
  try {
    await recordClinicPayment(actor, tenantId, { amount: fd.get("amount"), method: fd.get("method"), receivedOn: fd.get("receivedOn"), note: fd.get("note") ?? "" }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  revalidatePath("/admin");
  return { ok: true, message: "admin.billing.paymentSaved", nonce: Date.now() };
}

export async function voidBillingEntryAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("subscriptions.manage");
  if (fd.get("confirm") !== "yes") return { message: "validation.confirmRequired", nonce: Date.now() };
  let tenantId: string;
  try {
    const id = String(fd.get("id") ?? "");
    tenantId = fd.get("kind") === "invoice" ? await voidClinicInvoice(actor, id, await requestMeta()) : await voidClinicPayment(actor, id, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  revalidatePath("/admin");
  return { ok: true, message: "admin.billing.voided", nonce: Date.now() };
}

export async function billingSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("subscriptions.manage");
  try {
    await updateBillingSettings(actor, { dueDays: fd.get("dueDays"), suspendAfterDays: fd.get("suspendAfterDays"), autoSuspend: fd.get("autoSuspend") }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true, message: "admin.billing.settingsSaved", nonce: Date.now() };
}

/** Runs the monthly job now (it also runs hourly in the worker): invoices, then automatic suspensions. */
export async function runBillingNowAction(): Promise<FormState> {
  const actor = await requirePlatform("subscriptions.manage");
  if (actor.user.role !== "SUPER_ADMIN") return { message: "errors.forbidden" };
  const invoices = await generateMonthlyInvoices();
  const suspended = await suspendOverdueClinics();
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true, message: "admin.billing.ran", messageValues: { invoices, suspended }, nonce: Date.now() };
}

// ───────────── Platform staff ─────────────

export async function inviteStaffAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("staff.manage");
  let r: Awaited<ReturnType<typeof invitePlatformStaff>>;
  try {
    r = await invitePlatformStaff(actor, { email: fd.get("email"), fullName: fd.get("fullName"), role: fd.get("role") }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath("/admin/staff");
  return { ok: true, message: r.delivered ? "admin.staff.invited" : "admin.staff.invitedNoEmail", nonce: Date.now() };
}

export async function staffInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("staff.manage");
  const id = String(fd.get("invitationId"));
  const op = String(fd.get("op"));
  try {
    if (op === "resend") {
      const r = await resendPlatformInvitation(actor, id, await requestMeta());
      if (!r.delivered) return { message: "admin.staff.invitedNoEmail", nonce: Date.now() };
    } else if (op === "revoke") await revokePlatformInvitation(actor, id, await requestMeta());
    else return { message: "errors.invalidInput" };
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/admin/staff");
  return { ok: true, message: op === "resend" ? "admin.staff.resent" : "admin.staff.revoked", nonce: Date.now() };
}

/** Public: the invited person creates their console account from the emailed link. */
export async function acceptStaffInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await acceptPlatformInvitation(
      String(fd.get("token") ?? ""),
      { fullName: fd.get("fullName"), username: fd.get("username"), password: fd.get("password"), confirmPassword: fd.get("confirmPassword") },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd); // password fields are never echoed back (SENSITIVE_FIELDS)
  }
  redirect("/admin/login?activated=1");
}

// ───────────── Audit ─────────────

export async function verifyAuditAction(): Promise<FormState> {
  await requirePlatform("audit.read");
  const rows = await platformDb().$queryRaw<{ checked: bigint; first_broken_seq: bigint | null }[]>`SELECT * FROM audit_verify_chain(NULL)`;
  const r = rows[0];
  if (!r) return { message: "errors.generic" };
  if (r.first_broken_seq !== null) return { message: "admin.audit.chainBroken", messageValues: { seq: Number(r.first_broken_seq) }, nonce: Date.now() };
  return { ok: true, message: "admin.audit.chainOk", messageValues: { count: Number(r.checked) }, nonce: Date.now() };
}

// ───────────── Support access ─────────────

export async function supportRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("support.request_access");
  const tenantId = String(fd.get("tenantId"));
  try {
    await requestSupportAccess(
      actor,
      tenantId,
      { scope: fd.get("scope"), durationMinutes: fd.get("durationMinutes"), reason: fd.get("reason"), ticketRef: fd.get("ticketRef") ?? "" },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/clinics/${tenantId}`);
  return { ok: true, message: "admin.support.requested", nonce: Date.now() };
}

export async function createNetworkAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("networks.manage");
  let id: string;
  try {
    id = await createNetwork(actor, Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath("/admin/networks");
  redirect(`/admin/networks/${id}?created=1`);
}

export async function tenantNetworkAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("networks.manage");
  const networkId = String(fd.get("networkId") ?? "");
  const tenantId = String(fd.get("tenantId") ?? "");
  const remove = fd.get("op") === "remove";
  try {
    await setTenantNetwork(actor, tenantId, remove ? null : networkId, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/networks/${networkId}`);
  return { ok: true, message: remove ? "admin.networks.clinicRemoved" : "admin.networks.clinicAdded", nonce: Date.now() };
}

export async function networkAdminAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("staff.manage");
  const networkId = String(fd.get("networkId") ?? "");
  let r: Awaited<ReturnType<typeof createPlatformAccount>>;
  try {
    r = await createPlatformAccount(
      actor,
      { email: fd.get("email"), fullName: fd.get("fullName"), role: "NETWORK_ADMIN", networkId, ownerMode: fd.get("ownerMode"), username: fd.get("username"), password: fd.get("password") },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/admin/networks/${networkId}`);
  return { ok: true, message: r.mode === "password" ? "admin.networks.adminCreated" : r.delivered ? "admin.staff.invited" : "admin.staff.invitedNoEmail", nonce: Date.now() };
}
