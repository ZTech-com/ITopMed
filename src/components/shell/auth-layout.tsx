import type { ReactNode } from "react";
import { currentTheme } from "./app-shell";
import { InstallApp } from "../install-app";
import { Preferences } from "./preferences";

/** Centered card layout for sign-in, MFA and invitation pages. */
export async function AuthLayout({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const theme = await currentTheme();
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-soft),transparent)]" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#2b8cff] to-[#0a55c4] text-white">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">ITop Med</span>
        </div>
        <div className="w-[300px] max-w-[60vw]">
          <Preferences theme={theme} compact />
        </div>
      </header>
      <main id="main" className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="animate-rise w-full max-w-[420px]">
          <div className="mb-7 text-center">
            {eyebrow ? <p className="mb-2 text-[13px] font-medium text-text-3">{eyebrow}</p> : null}
            <h1 className="text-[26px] font-semibold tracking-[-0.022em]">{title}</h1>
            {subtitle ? <p className="mt-2 text-[15px] leading-relaxed text-text-2">{subtitle}</p> : null}
          </div>
          <div className="rounded-[20px] border border-border bg-surface p-6 shadow-card sm:p-8">{children}</div>
          <div className="mx-auto mt-5 max-w-[300px]">
            <InstallApp />
          </div>
        </div>
      </main>
    </div>
  );
}
