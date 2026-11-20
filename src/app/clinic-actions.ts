"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import type { FormState } from "@/lib/form-state";
import { loginSchema } from "@/lib/validation";
import { toFormState } from "@/server/actions-util";
import { loginClinicUser, logoutClinic, resolveClinic, unlinkClinicTelegram, validateClinicSession } from "@/server/auth/clinic-auth";
import { homeForRoles } from "@/server/auth/landing";
import { clearClinicCookie, readClinicToken, setClinicSessionCookie } from "@/server/auth/cookies";
import { requireClinic } from "@/server/auth/guards";
import { createBranch, createStaffWithPassword, inviteStaff, updateClinicSettings } from "@/server/clinic/admin";
import { requestMeta } from "@/server/http";
import { acceptInvitation, acceptInvitationAsExistingUser } from "@/server/tenancy/invitations";
import { safeNext } from "@/lib/safe-next";
import { requestPasswordReset, resetPassword } from "@/server/auth/password-reset";
import { createRole, deleteRole, updateRole } from "@/server/clinic/roles";
import { setMemberPassword, setMemberStatus, updateMemberAccess, type MemberStatusAction } from "@/server/clinic/members";
import { decideGrant, type GrantDecision } from "@/server/support/access";
import { getClinicPrincipal, requireClinicUser } from "@/server/auth/guards";

async function applyLocale(token: string) {
  // Priority: saved account preference → language chosen in this browser → clinic default.
  const p = await validateClinicSession(token);
  const store = await cookies();
  const browserChoice = store.get(LOCALE_COOKIE)?.value;
  const preferred = p?.user.locale ?? (isLocale(browserChoice) ? browserChoice : p?.clinics[0]?.defaultLocale);
  if (isLocale(preferred)) store.set(LOCALE_COOKIE, preferred, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return p;
}

export async function clinicLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ username: fd.get("username"), password: fd.get("password") });
  if (!parsed.success) return { message: "auth.invalid", values: { username: String(fd.get("username") ?? "") } };
  const r = await loginClinicUser(parsed.data.username, parsed.data.password, await requestMeta());
  if (!r.ok) return { message: `auth.${r.reason === "rate_limited" ? "rateLimited" : r.reason}`, values: { username: parsed.data.username } };
  await setClinicSessionCookie(r.token);
  const p = await applyLocale(r.token);
  // From a clinic's own page (/login/<slug>): straight to that clinic, on the page for the person's role.
  const slug = String(fd.get("$slug") ?? "");
  const ctx = p && /^[a-z0-9-]{3,48}$/.test(slug) ? await resolveClinic(p, slug) : null;
  redirect(ctx ? homeForRoles(ctx.tenant.slug, ctx.roleKeys) : (safeNext(fd.get("next")) ?? "/clinics"));
}

/** Removes the Telegram sign-in from the person's own account. */
export async function unlinkTelegramAction(): Promise<FormState> {
  const p = await requireClinicUser();
  await unlinkClinicTelegram(p, await requestMeta());
  revalidatePath("/account/security");
  return { ok: true, message: "security.telegramUnlinked", nonce: Date.now() };
}

export async function clinicLogoutAction() {
  await logoutClinic(await readClinicToken());
  await clearClinicCookie();
  redirect("/login");
}

export async function acceptInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  try {
    await acceptInvitation(
      token,
      { fullName: fd.get("fullName"), username: fd.get("username"), password: fd.get("password"), confirmPassword: fd.get("confirmPassword") },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd);
  }
  redirect("/login?activated=1");
}

// ───────────── Clinic administration ─────────────

export async function clinicSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "clinic.settings.manage");
  try {
    await updateClinicSettings(ctx, Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}`, "layout");
  return { ok: true, message: "clinic.settings.saved", nonce: Date.now() };
}

export async function createBranchAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "clinic.branches.manage");
  try {
    await createBranch(ctx, Object.fromEntries(fd.entries()), await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/branches`);
  return { ok: true, message: "clinic.branches.created", nonce: Date.now() };
}

export async function inviteStaffAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "staff.manage");
  try {
    const input = { fullName: fd.get("fullName"), email: fd.get("email"), roleKeys: fd.getAll("roleKeys") };
    if (fd.get("access") !== "invite") {
      const username = await createStaffWithPassword(ctx, { ...input, username: fd.get("username"), password: fd.get("password") }, await requestMeta());
      revalidatePath(`/c/${slug}/staff`);
      // The password is not echoed back: the administrator has just typed or copied it.
      return { ok: true, message: "clinic.staff.created", messageValues: { username }, nonce: Date.now() };
    }
    const r = await inviteStaff(ctx, input, await requestMeta());
    revalidatePath(`/c/${slug}/staff`);
    // The invitation token is delivered only by email and never returned to the browser.
    return { ok: true, message: r.delivered ? "clinic.staff.invited" : "clinic.staff.invitedNoEmail", nonce: Date.now() };
  } catch (e) {
    return toFormState(e, fd);
  }
}

// ───────────── Password reset ─────────────

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  // Same answer whether or not the account exists (no account enumeration).
  await requestPasswordReset(String(fd.get("email") ?? ""), await requestMeta());
  return { ok: true, message: "auth.resetRequestSent", nonce: Date.now() };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await resetPassword(String(fd.get("token") ?? ""), { password: fd.get("password"), confirmPassword: fd.get("confirmPassword") }, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  await clearClinicCookie();
  redirect("/login?reset=1");
}

// ───────────── Invitations for existing accounts ─────────────

export async function acceptExistingInvitationAction(_: FormState, fd: FormData): Promise<FormState> {
  const p = await requireClinicUser();
  let slug: string;
  try {
    ({ slug } = await acceptInvitationAsExistingUser(String(fd.get("token") ?? ""), p, await requestMeta()));
  } catch (e) {
    return toFormState(e);
  }
  redirect(`/c/${slug}`);
}

export async function switchAccountAction(fd: FormData) {
  const next = safeNext(fd.get("next"));
  if (await getClinicPrincipal()) await logoutClinic(await readClinicToken());
  await clearClinicCookie();
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}

// ───────────── Roles ─────────────

function permissionsFrom(fd: FormData) {
  return fd.getAll("permissions").map(String);
}

export async function createRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "roles.manage");
  let id: string;
  try {
    id = await createRole(ctx, { name: fd.get("name"), permissions: permissionsFrom(fd) }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  redirect(`/c/${slug}/roles/${id}?created=1`);
}

export async function updateRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "roles.manage");
  const roleId = String(fd.get("roleId"));
  try {
    await updateRole(ctx, roleId, { name: fd.get("name") ?? undefined, permissions: permissionsFrom(fd) }, await requestMeta());
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/roles`, "layout");
  return { ok: true, message: "clinic.roles.saved", nonce: Date.now() };
}

export async function deleteRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "roles.manage");
  try {
    await deleteRole(ctx, String(fd.get("roleId")), await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  redirect(`/c/${slug}/roles?deleted=1`);
}

// ───────────── Members ─────────────

export async function memberAccessAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "staff.manage");
  const membershipId = String(fd.get("membershipId"));
  try {
    await updateMemberAccess(
      ctx,
      membershipId,
      { roleIds: fd.getAll("roleIds").map(String), allBranches: fd.get("branchScope") !== "selected", branchIds: fd.getAll("branchIds").map(String) },
      await requestMeta(),
    );
  } catch (e) {
    return toFormState(e, fd);
  }
  revalidatePath(`/c/${slug}/staff`, "layout");
  return { ok: true, message: "clinic.member.saved", nonce: Date.now() };
}

export async function memberStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "staff.manage");
  const op = String(fd.get("op")) as MemberStatusAction;
  if (!["suspend", "reactivate", "remove"].includes(op)) return { message: "errors.invalidInput" };
  try {
    await setMemberStatus(ctx, String(fd.get("membershipId")), op, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/c/${slug}/staff`, "layout");
  return { ok: true, message: "clinic.member.statusChanged", nonce: Date.now() };
}

export async function memberPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "staff.manage");
  try {
    await setMemberPassword(ctx, String(fd.get("membershipId")), { password: fd.get("password") }, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  return { ok: true, message: "clinic.member.passwordSet", nonce: Date.now() };
}

// ───────────── Support access decisions ─────────────

export async function supportDecisionAction(_: FormState, fd: FormData): Promise<FormState> {
  const slug = String(fd.get("$slug"));
  const ctx = await requireClinic(slug, "support_access.decide");
  const op = String(fd.get("op")) as GrantDecision;
  if (!["approve", "deny", "revoke"].includes(op)) return { message: "errors.invalidInput" };
  try {
    await decideGrant(ctx, String(fd.get("grantId")), op, await requestMeta());
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath(`/c/${slug}/support-access`);
  return { ok: true, message: `clinic.supportAccess.${op === "approve" ? "approved" : op === "deny" ? "denied" : "revoked"}`, nonce: Date.now() };
}
