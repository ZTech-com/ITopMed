import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { platformCan, type PlatformPermission } from "../authz/platform";
import type { Permission } from "../authz/permissions";
import { resolveClinic, validateClinicSession } from "./clinic-auth";
import { readAdminToken, readClinicToken } from "./cookies";
import { validatePlatformSession } from "./platform-auth";

/** Memoised per request. */
export const getPlatformPrincipal = cache(async () => validatePlatformSession(await readAdminToken()));
export const getClinicPrincipal = cache(async () => validateClinicSession(await readClinicToken()));

/** Every platform console page and action calls this first. */
export async function requirePlatform(permission?: PlatformPermission) {
  const p = await getPlatformPrincipal();
  if (!p) redirect("/admin/login");
  if (!p.mfaVerified) redirect("/admin/mfa");
  // Resources the role may not use are reported as not found (no information leak).
  if (permission && !platformCan(p.user.role, permission)) notFound();
  return p;
}

export async function requireClinicUser() {
  const p = await getClinicPrincipal();
  if (!p) redirect("/login");
  if (p.mfaRequired && !p.mfaVerified) redirect("/mfa");
  return p;
}

const getClinicContext = cache(async (slug: string) => {
  const p = await requireClinicUser();
  return resolveClinic(p, slug);
});

/** Every clinic page and action calls this first: membership + tenant status + permission. */
export async function requireClinic(slug: string, permission?: Permission) {
  const ctx = await getClinicContext(slug);
  if (!ctx) notFound();
  if (permission && !ctx.permissions.has(permission)) notFound();
  return ctx;
}
