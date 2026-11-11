import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Locale resolution (no locale in the URL — this is an authenticated app):
 *   1. explicit per-user choice persisted in the `itm_locale` cookie
 *      (written on login from the user's saved preference, and by the switcher)
 *   2. Uzbek Latin default
 * Clinic default languages are applied on login when the user has no own preference.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "Asia/Tashkent",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
