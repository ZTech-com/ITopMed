"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { getClinicPrincipal, getPlatformPrincipal } from "@/server/auth/guards";
import { platformDb, withAppContext } from "@/server/db";

const YEAR = 60 * 60 * 24 * 365;

/** Persists the UI language for this browser and, when signed in, on the account. */
export async function setLocaleAction(fd: FormData) {
  const locale = fd.get("locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: false });

  const [admin, clinic] = await Promise.all([getPlatformPrincipal(), getClinicPrincipal()]);
  if (admin) await platformDb().platformUser.update({ where: { id: admin.user.id }, data: { locale } });
  if (clinic) {
    await withAppContext({ userId: clinic.user.id, sessionId: clinic.sessionId }, (tx) =>
      tx.user.update({ where: { id: clinic.user.id }, data: { locale } }),
    );
  }
}

export async function setThemeAction(fd: FormData) {
  const theme = fd.get("theme");
  if (theme !== "light" && theme !== "dark" && theme !== "system") return;
  const store = await cookies();
  if (theme === "system") store.delete("itm_theme");
  else store.set("itm_theme", theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
}
