import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { readPatientToken } from "../auth/cookies";
import { portalTenant, validatePatientSession } from "./auth";

/** Memoised per request. */
export const getPatientPrincipal = cache(async () => validatePatientSession(await readPatientToken()));

export const getPortalTenant = cache(async (slug: string) => portalTenant(slug));

/** Every portal page and action calls this first. A session only ever works for its own clinic. */
export async function requirePatient(slug: string) {
  const tenant = await getPortalTenant(slug);
  if (!tenant) notFound();
  const p = await getPatientPrincipal();
  if (!p || p.tenant.id !== tenant.id) redirect(`/p/${tenant.slug}/login`);
  return p;
}
