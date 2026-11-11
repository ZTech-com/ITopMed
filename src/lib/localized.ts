/** Picks a value from a { "uz-Latn": ..., "ru": ... } JSON map, falling back to uz-Latn then English. */
export function localizedName(value: unknown, locale: string): string {
  if (value && typeof value === "object") {
    const m = value as Record<string, unknown>;
    for (const k of [locale, "uz-Latn", "en"]) if (typeof m[k] === "string") return m[k] as string;
  }
  return typeof value === "string" ? value : "";
}
