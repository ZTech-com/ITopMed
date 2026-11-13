import { describe, expect, it } from "vitest";
import { loginClinicUser, validateClinicSession } from "@/server/auth/clinic-auth";
import { createPlatformUser, loginPlatformUser, validatePlatformSession } from "@/server/auth/platform-auth";
import { platformDb } from "@/server/db";
import { inviteStaff } from "@/server/clinic/admin";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { META, PASSWORD, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

// env() is read lazily, so this applies before the first sign-in of this file.
const EXEMPT_PLATFORM = `${uniq("exempt")}@itopmed.test`;
const EXEMPT_CLINIC = `${uniq("exempt-admin")}@clinic.test`;
process.env.MFA_EXEMPT_EMAILS = ` ${EXEMPT_PLATFORM.toUpperCase()} , ${EXEMPT_CLINIC}`;

describe("MFA_EXEMPT_EMAILS (owner exception)", () => {
  it("a listed platform account is signed in by the password alone, and the audit says so", async () => {
    await createPlatformUser({ email: EXEMPT_PLATFORM, fullName: "Synthetic Exempt", password: PASSWORD, role: "SUPER_ADMIN" });
    const r = await loginPlatformUser(EXEMPT_PLATFORM, PASSWORD, META);
    expect(r.ok && r.mfaExempt).toBe(true);
    if (!r.ok) return;
    expect((await validatePlatformSession(r.token))?.mfaVerified).toBe(true);
    const user = await platformDb().platformUser.findUniqueOrThrow({ where: { email: EXEMPT_PLATFORM } });
    const audit = await platformDb().auditEvent.findFirst({ where: { actorId: user.id, action: "platform.login.password" }, orderBy: { seq: "desc" } });
    expect(audit?.metadata).toEqual({ mfaExempt: true });
    // A wrong password is still refused.
    expect((await loginPlatformUser(EXEMPT_PLATFORM, "wrong-password-123", META)).ok).toBe(false);
  });

  it("everybody else still needs the authenticator code", async () => {
    const email = `${uniq("normal")}@itopmed.test`;
    await createPlatformUser({ email, fullName: "Synthetic Normal", password: PASSWORD, role: "SUPER_ADMIN" });
    const r = await loginPlatformUser(email, PASSWORD, META);
    expect(r.ok && r.mfaExempt).toBe(false);
    if (r.ok) expect((await validatePlatformSession(r.token))?.mfaVerified).toBe(false);

    // A clinic owner (MFA required) who is not listed lands on the MFA step.
    const a = await clinicWithOwner(await platformActor());
    const c = await loginClinicUser(a.ownerEmail, PASSWORD, META);
    if (!c.ok) throw new Error("login");
    const p = await validateClinicSession(c.token);
    expect(p?.mfaRequired).toBe(true);
    expect(p?.mfaVerified).toBe(false);
  });

  it("a listed clinic administrator (normally MFA-required) goes straight in", async () => {
    const a = await clinicWithOwner(await platformActor());
    const inv = await inviteStaff(a.ctx, { fullName: "Synthetic Admin", email: EXEMPT_CLINIC, roleKeys: ["clinic_admin"] }, META);
    await acceptInvitation(inv.token, { fullName: "Synthetic Admin", password: PASSWORD, confirmPassword: PASSWORD }, META);
    const c = await loginClinicUser(EXEMPT_CLINIC, PASSWORD, META);
    if (!c.ok) throw new Error("login");
    const p = await validateClinicSession(c.token);
    expect(p?.mfaRequired).toBe(true);
    expect(p?.mfaVerified).toBe(true);
  });
});
