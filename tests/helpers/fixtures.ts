import { randomBytes } from "node:crypto";
import { createPlatformUser, validatePlatformSession, type PlatformPrincipal } from "@/server/auth/platform-auth";
import { loginClinicUser, resolveClinic, validateClinicSession } from "@/server/auth/clinic-auth";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { provisionClinic } from "@/server/tenancy/provisioning";
import type { PlatformRole } from "@/generated/prisma/client";

/** Fresh documentation-range IP per access so tests do not trip the per-IP rate limiter. */
export const META = {
  get ip() {
    return `198.51.100.${Math.floor(Math.random() * 254) + 1}:${randomBytes(2).toString("hex")}`;
  },
  userAgent: "vitest",
};
export const PASSWORD = "Synthetic-Passw0rd-2026";

export const uniq = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** A platform principal as it looks after a completed sign-in. */
export async function platformActor(role: PlatformRole = "SUPER_ADMIN"): Promise<PlatformPrincipal> {
  const username = uniq("staff");
  const id = await createPlatformUser({ username, fullName: "Synthetic Staff", password: PASSWORD, role });
  return {
    sessionId: "test",
    user: { id, username, fullName: "Synthetic Staff", role, locale: "en" },
  };
}

/** Provisions a clinic and activates its owner account (login + password, no email). All data synthetic. */
export async function clinicWithOwner(actor: PlatformPrincipal) {
  const slug = uniq("clinic");
  const ownerLogin = uniq("owner");
  const p = await provisionClinic(
    actor,
    {
      name: `Synthetic Clinic ${slug}`,
      slug,
      defaultLocale: "uz-Latn",
      timezone: "Asia/Tashkent",
      // Enterprise includes every module; module limits are tested explicitly.
      planCode: "enterprise",
      ownerFullName: "Synthetic Owner",
      taxId: "",
      contactPhone: "",
    },
    META,
  );
  await acceptInvitation(p.inviteToken, { fullName: "Synthetic Owner", username: ownerLogin, password: PASSWORD, confirmPassword: PASSWORD }, META);
  const ctx = await clinicContext(ownerLogin, slug);
  return { ...p, ownerLogin, ctx };
}

export async function clinicContext(login: string, slug: string) {
  const r = await loginClinicUser(login, PASSWORD, META);
  if (!r.ok) throw new Error(`login failed: ${r.reason}`);
  const principal = await validateClinicSession(r.token);
  if (!principal) throw new Error("no session");
  const ctx = await resolveClinic(principal, slug);
  if (!ctx) throw new Error("no clinic context");
  return ctx;
}

export { validatePlatformSession };
