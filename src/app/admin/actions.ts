"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { FormState } from "@/lib/form-state";
import { loginSchema, totpCodeSchema } from "@/lib/validation";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { toFormState } from "@/server/actions-util";
import { clearAdminCookie, readAdminToken, setAdminSessionCookie } from "@/server/auth/cookies";
import { requirePlatform } from "@/server/auth/guards";
import {
  generatePlatformRecoveryCodes,
  loginPlatformUser,
  logoutPlatform,
  platformRecoveryCodeStatus,
  resetPlatformStaffMfa,
  validatePlatformSession,
  verifyPlatformMfa,
  verifyPlatformRecoveryCode,
} from "@/server/auth/platform-auth";
import {
  acceptPlatformInvitation,
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
  createClinicAndInvite,
  resendInvitation,
  revokeInvitation,
  setTenantModule,
  type LifecycleAction,
} from "@/server/tenancy/provisioning";

// ───────────── Authentication ─────────────

export async function adminLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { message: "auth.invalid", values: { email: String(fd.get("email") ?? "") } };
  const r = await loginPlatformUser(parsed.data.email, parsed.data.password, await requestMeta());
  if (!r.ok) return { message: `auth.${r.reason === "rate_limited" ? "rateLimited" : r.reason}`, values: { email: parsed.data.email } };
  await setAdminSessionCookie(r.token);
  redirect(r.mfaExempt ? "/admin" : "/admin/mfa");
}

export async function adminMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const code = totpCodeSchema.safeParse(fd.get("code"));
  if (!code.success) return { fieldErrors: { code: "validation.otp" } };
  const token = await readAdminToken();
  if (!token) redirect("/admin/login");
  const r = await verifyPlatformMfa(token, code.data, await requestMeta());
  if (!r.ok) return { message: r.reason === "rate_limited" ? "auth.rateLimited" : "auth.mfaInvalid" };
  await setAdminSessionCookie(r.token);
  const p = await validatePlatformSession(r.token);
  if (p && isLocale(p.user.locale)) (await cookies()).set(LOCALE_COOKIE, p.user.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  // Without recovery codes a lost phone means a locked-out account: ask for them right away.
  if (p && !(await platformRecoveryCodeStatus(p.user.id)).issued) redirect("/admin/security?setup=1");
  redirect("/admin");
}

/** Second factor with a one-time recovery code (lost authenticator). */
export async function adminRecoveryCodeAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await readAdminToken();
  if (!token) redirect("/admin/login");
  const r = await verifyPlatformRecoveryCode(token, String(fd.get("recoveryCode") ?? "").slice(0, 64), await requestMeta());
  if (!r.ok) return { message: r.reason === "rate_limited" ? "auth.rateLimited" : "auth.recoveryInvalid", nonce: Date.now() };
  await setAdminSessionCookie(r.token);
  redirect("/admin/security?used=1");
}

export async function generateAdminRecoveryCodesAction(): Promise<FormState> {
  const actor = await requirePlatform();
  try {
    const codes = await generatePlatformRecoveryCodes(actor, await requestMeta());
    revalidatePath("/admin/security");
    // Shown once in the browser; never stored in clear and never logged.
    return { ok: true, data: { codes }, nonce: Date.now() };
  } catch (e) {
    return toFormState(e);
  }
}

export async function adminLogoutAction() {
  await logoutPlatform(await readAdminToken());
  await clearAdminCookie();
  redirect("/admin/login");
}

// ───────────── Clinics ─────────────

export async function createClinicAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("tenants.create");
  let result: Awaited<ReturnType<typeof createClinicAndInvite>>;
  try {
    result = await createClinicAndInvite(actor, Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath("/admin/clinics");
  redirect(`/admin/clinics/${result.tenantId}?created=${result.invitationDelivered ? "1" : "nomail"}`);
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

export async function resetStaffMfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requirePlatform("staff.manage");
  if (fd.get("confirm") !== "yes") return { message: "validation.confirmRequired", nonce: Date.now() };
  try {
    await resetPlatformStaffMfa(actor, String(fd.get("userId")), await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/admin/staff");
  // The row's reset form disappears once MFA is off, so the confirmation is shown at page level.
  redirect("/admin/staff?mfaReset=1");
}

/** Public: the invited person creates their console account from the emailed link. */
export async function acceptStaffInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await acceptPlatformInvitation(
      String(fd.get("token") ?? ""),
      { fullName: fd.get("fullName"), password: fd.get("password"), confirmPassword: fd.get("confirmPassword") },
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
