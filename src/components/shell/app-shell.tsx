import { LogOut, Menu, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { InstallApp } from "../install-app";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavLinks, type NavItem } from "./nav-links";
import { Preferences } from "./preferences";

export async function currentTheme(): Promise<"light" | "dark" | "system"> {
  const v = (await cookies()).get("itm_theme")?.value;
  return v === "light" || v === "dark" ? v : "system";
}

function Brand({ context }: { context: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span aria-hidden className="grid size-9 place-items-center rounded-[12px] bg-accent-solid text-on-accent">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-[16px] font-extrabold tracking-[-0.02em]">ITop Med</p>
        <p className="truncate text-[12px] text-text-3">{context}</p>
      </div>
    </div>
  );
}

/**
 * Shared workspace chrome: translucent sidebar on desktop, collapsible
 * menu on phones/tablets (native <details>, works without JavaScript).
 */
export async function AppShell({
  context,
  nav,
  user,
  signOut,
  securityHref,
  children,
  banner,
  primary,
}: {
  context: string;
  nav: NavItem[];
  user: { name: string; detail: string };
  signOut: () => Promise<void>;
  /** Account security page (password, linked Telegram). */
  securityHref?: string;
  children: ReactNode;
  banner?: ReactNode;
  /** Up to 4 primary screens for the phone/tablet bottom bar. */
  primary?: NavItem[];
}) {
  const t = await getTranslations();
  const theme = await currentTheme();

  const footer = (
    <div className="space-y-3 border-t border-border pt-4">
      <InstallApp />
      <Preferences theme={theme} />
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{user.name}</p>
          <p className="truncate text-[12px] text-text-3">{user.detail}</p>
        </div>
        {securityHref ? (
          <Link href={securityHref} title={t("common.accountSecurity")} className="ml-auto grid size-10 shrink-0 place-items-center rounded-full bg-surface text-text-2 hover:text-text">
            <ShieldCheck aria-hidden className="size-[18px]" />
            <span className="sr-only">{t("common.accountSecurity")}</span>
          </Link>
        ) : null}
        <form action={signOut}>
          <button type="submit" title={t("common.signOut")} className="grid size-10 place-items-center rounded-full bg-surface text-text-2 hover:text-text">
            <LogOut aria-hidden className="size-[18px]" />
            <span className="sr-only">{t("common.signOut")}</span>
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
        {t("a11y.skipToContent")}
      </a>

      {/* Desktop sidebar */}
      {/* Desktop: a floating rounded panel on the soft ground. */}
      <aside className="sticky top-0 hidden h-dvh w-[280px] shrink-0 p-3 lg:block">
        <div className="flex h-full flex-col rounded-[28px] bg-sidebar p-4">
          <Brand context={context} />
          <div className="mt-6 flex-1 overflow-y-auto">
            <NavLinks items={nav} label={t("a11y.mainNav")} />
          </div>
          {footer}
        </div>
      </aside>

      {/* Phone / tablet header */}
      <details className="group sticky top-0 z-30 border-b border-border bg-sidebar lg:hidden">
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-4 [&::-webkit-details-marker]:hidden">
          <Brand context={context} />
          <span className="grid size-11 place-items-center rounded-full bg-surface text-text-2 group-open:bg-accent-solid group-open:text-on-accent">
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">{t("a11y.openMenu")}</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
          <NavLinks items={nav} label={t("a11y.mainNav")} />
          {footer}
        </div>
      </details>

      <main id="main" className={primary && primary.length > 1 ? "min-w-0 flex-1 pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0" : "min-w-0 flex-1"}>
        {banner}
        <div className="animate-rise mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-8">{children}</div>
      </main>
      {primary ? <MobileTabBar items={primary.slice(0, 4)} label={t("a11y.mainNav")} /> : null}
    </div>
  );
}
