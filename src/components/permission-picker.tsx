import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PERMISSION_GROUPS, permissionMessageKey } from "@/server/clinic/roles";
import { cx } from "./ui/primitives";

/** Grouped permission checkboxes. Plain inputs, so it works without JavaScript. */
export async function PermissionPicker({ selected, disabled }: { selected: Set<string>; disabled?: boolean }) {
  const t = await getTranslations();
  return (
    <div className="space-y-6">
      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.key} disabled={disabled}>
          <legend className="text-[13px] font-semibold uppercase tracking-[0.04em] text-text-3">{t(`permissionGroups.${g.key}` as never)}</legend>
          {g.key === "clinical" ? (
            <p className="mt-2 flex items-start gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[13px] text-warning">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t("clinic.roles.clinicalWarning")}
            </p>
          ) : null}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.permissions.map((p) => (
              <label
                key={p}
                className={cx(
                  "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 text-[14px]",
                  "has-[:checked]:border-accent has-[:checked]:bg-accent-soft",
                  disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                )}
              >
                <input type="checkbox" name="permissions" value={p} defaultChecked={selected.has(p)} className="size-4 accent-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="block">{t(permissionMessageKey(p) as never)}</span>
                  <span className="block font-mono text-[11px] text-text-3">{p}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
