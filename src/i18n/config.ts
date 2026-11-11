export const LOCALES = ["uz-Latn", "uz-Cyrl", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "uz-Latn";
export const LOCALE_COOKIE = "itm_locale";

/** Each language's name written in that language (never translated). */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  "uz-Latn": "Oʻzbekcha",
  "uz-Cyrl": "Ўзбекча",
  ru: "Русский",
  en: "English",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export const TIMEZONES = ["Asia/Tashkent", "Asia/Samarkand", "UTC"] as const;
export const CURRENCIES = ["UZS", "USD"] as const;
