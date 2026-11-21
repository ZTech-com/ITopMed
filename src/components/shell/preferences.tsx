"use client";

import { Globe, Moon, Sun, SunMoon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction, setThemeAction } from "@/app/actions/preferences";
import { LOCALES, LOCALE_NATIVE_NAMES } from "@/i18n/config";
import { cx } from "../ui/primitives";

const selectClass =
  "h-9 w-full appearance-none rounded-[var(--radius-control)] border border-border bg-surface pr-3 text-[13px] font-medium text-text hover:bg-surface-2 focus:outline-none focus:ring-4 focus:ring-[var(--focus)]";

/** Language + appearance controls. Plain forms, so they also work before hydration. */
export function Preferences({ theme, compact }: { theme: "light" | "dark" | "system"; compact?: boolean }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;

  return (
    <div className={cx("flex gap-2", compact ? "flex-row" : "flex-col")} aria-busy={pending}>
      <form action={setLocaleAction} className="relative min-w-0 flex-1">
        <label className="sr-only" htmlFor="pref-locale">
          {t("language")}
        </label>
        <Globe aria-hidden className={cx("pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-text-3", compact ? "left-2.5" : "left-3")} />
        <select
          id="pref-locale"
          name="locale"
          defaultValue={locale}
          className={cx(selectClass, compact ? "pl-8 pr-1.5 text-[12.5px]" : "pl-9")}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("locale", e.currentTarget.value);
            start(() => setLocaleAction(fd));
          }}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NATIVE_NAMES[l]}
            </option>
          ))}
        </select>
        <noscript>
          <button type="submit">{t("save")}</button>
        </noscript>
      </form>
      <form action={setThemeAction} className="relative min-w-0 flex-1">
        <label className="sr-only" htmlFor="pref-theme">
          {t("theme")}
        </label>
        <ThemeIcon aria-hidden className={cx("pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-text-3", compact ? "left-2.5" : "left-3")} />
        <select
          id="pref-theme"
          name="theme"
          defaultValue={theme}
          className={cx(selectClass, compact ? "pl-8 pr-1.5 text-[12.5px]" : "pl-9")}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("theme", e.currentTarget.value);
            start(() => setThemeAction(fd));
          }}
        >
          <option value="system">{t("themeSystem")}</option>
          <option value="light">{t("themeLight")}</option>
          <option value="dark">{t("themeDark")}</option>
        </select>
      </form>
    </div>
  );
}
