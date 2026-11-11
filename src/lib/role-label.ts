/** Display label for a role key: translated for standard roles, generic label for custom ones. */
export function roleLabel(t: { (key: never): string; has: (key: never) => boolean }, key: string, customName?: string | null): string {
  const k = `roles.${key}` as never;
  if (t.has(k)) return t(k);
  return customName ?? t("clinic.roles.custom" as never);
}
