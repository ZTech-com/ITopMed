import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "../env";
import { CLINIC_SESSION_ABSOLUTE_MS } from "./clinic-auth";
import { PLATFORM_SESSION_ABSOLUTE_MS } from "./platform-auth";
import { PATIENT_SESSION_ABSOLUTE_MS } from "../portal/auth";

/**
 * Session cookies: HttpOnly, Secure (production), SameSite, host-only.
 * In production the `__Host-` prefix forbids Domain and enforces Secure + Path=/.
 * The platform console uses SameSite=Strict; clinic workspaces use Lax so
 * that links opened from email/messengers keep the user signed in.
 */
export const adminCookieName = () => (isProduction() ? "__Host-itm_admin" : "itm_admin");
export const clinicCookieName = () => (isProduction() ? "__Host-itm_session" : "itm_session");
/** Patient portal: a separate cookie, so staff and patient sessions never mix in one browser. */
export const patientCookieName = () => (isProduction() ? "__Host-itm_patient" : "itm_patient");

export async function setAdminSessionCookie(token: string) {
  (await cookies()).set(adminCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict",
    path: "/",
    maxAge: PLATFORM_SESSION_ABSOLUTE_MS / 1000,
  });
}

export async function setClinicSessionCookie(token: string) {
  (await cookies()).set(clinicCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: CLINIC_SESSION_ABSOLUTE_MS / 1000,
  });
}

export async function setPatientSessionCookie(token: string) {
  (await cookies()).set(patientCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: PATIENT_SESSION_ABSOLUTE_MS / 1000,
  });
}

export async function readPatientToken() {
  return (await cookies()).get(patientCookieName())?.value;
}

export async function clearPatientCookie() {
  (await cookies()).delete(patientCookieName());
}

export async function readAdminToken() {
  return (await cookies()).get(adminCookieName())?.value;
}

export async function readClinicToken() {
  return (await cookies()).get(clinicCookieName())?.value;
}

export async function clearAdminCookie() {
  (await cookies()).delete(adminCookieName());
}

export async function clearClinicCookie() {
  (await cookies()).delete(clinicCookieName());
}
