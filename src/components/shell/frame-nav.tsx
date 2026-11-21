"use client";

import { LockKeyhole, LogOut, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { cx } from "../ui/primitives";
import { Icon } from "./icon";
import type { NavItem } from "./nav-links";

export function isActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

/** The capsule of primary screens in the top bar; the current one is the ink pill. */
export function TopNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="min-w-0">
      {/* Scrolls sideways only if long labels ever outgrow the bar (never clips). */}
      <ul className="scroll-quiet flex items-center gap-1 overflow-x-auto rounded-full bg-surface p-1.5">
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-11 items-center rounded-full px-5 text-[15px] whitespace-nowrap transition-[background-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)] active:scale-[0.97]",
                  active ? "bg-accent-solid font-semibold text-on-accent" : "font-medium text-text-2 hover:bg-chip hover:text-text",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Icon button of the left rail. The name is its accessible label and appears as a
 * tooltip on hover or keyboard focus. The tooltip is `position: fixed`, so the
 * rail may scroll without clipping it.
 */
export function RailTip({ label, children }: { label: string; children: (on: { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void; onPointerLeave: () => void; onFocus: (e: React.FocusEvent<HTMLElement>) => void; onBlur: () => void }) => ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAt({ x: r.right + 10, y: r.top + r.height / 2 });
  };
  return (
    <>
      {children({
        onPointerEnter: (e) => show(e.currentTarget),
        onPointerLeave: () => setAt(null),
        onFocus: (e) => (e.currentTarget.matches(":focus-visible") ? show(e.currentTarget) : undefined),
        onBlur: () => setAt(null),
      })}
      {at ? (
        <span
          aria-hidden
          style={{ left: at.x, top: at.y }}
          className="animate-tip pointer-events-none fixed z-50 -translate-y-1/2 rounded-full bg-accent-solid px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-on-accent shadow-pop"
        >
          {label}
        </span>
      ) : null}
    </>
  );
}

export const railButton =
  "grid size-11 place-items-center rounded-full text-text-2 transition-[background-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:bg-chip hover:text-text active:scale-[0.95]";

/** The rail's capsule of the remaining sections, one thin divider between groups. */
export function RailNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  if (!items.length) return null;
  return (
    <nav aria-label={label} className="flex min-h-0 flex-col">
      <ul className="scroll-quiet flex min-h-0 flex-col items-center gap-1 overflow-y-auto rounded-full bg-surface p-1.5">
        {items.map((item, i) => {
          const active = isActive(item, pathname);
          const newGroup = i > 0 && item.group !== items[i - 1]!.group;
          return (
            <Fragment key={item.href}>
              {newGroup ? <li aria-hidden className="my-1 h-px w-6 shrink-0 bg-border-strong" /> : null}
              <li className="shrink-0">
                <RailTip label={item.label}>
                  {(on) => (
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cx(railButton, active && "bg-accent-solid text-on-accent hover:bg-accent-solid hover:text-on-accent")}
                      {...on}
                    >
                      <Icon name={item.icon} className="size-5" />
                    </Link>
                  )}
                </RailTip>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}

const RAIL_ICONS = { sun: Sun, moon: Moon, security: LockKeyhole, signOut: LogOut } as const;

/** A rail button that submits a form (theme, sign out); works before hydration too. */
export function RailForm({ action, label, icon, field, pressed }: { action: (fd: FormData) => void | Promise<void>; label: string; icon: keyof typeof RAIL_ICONS; field?: { name: string; value: string }; pressed?: boolean }) {
  const I = RAIL_ICONS[icon];
  return (
    <form action={action}>
      {field ? <input type="hidden" name={field.name} value={field.value} /> : null}
      <RailTip label={label}>
        {(on) => (
          <button type="submit" aria-label={label} aria-pressed={pressed} className={cx(railButton, pressed && "bg-tile text-text")} {...on}>
            <I aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
        )}
      </RailTip>
    </form>
  );
}

/** A rail link with a tooltip (account security). */
export function RailLink({ href, label, icon }: { href: string; label: string; icon: keyof typeof RAIL_ICONS }) {
  const I = RAIL_ICONS[icon];
  const pathname = usePathname();
  const active = pathname === href.split("?")[0];
  return (
    <RailTip label={label}>
      {(on) => (
        <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cx(railButton, active && "bg-accent-solid text-on-accent")} {...on}>
          <I aria-hidden className="size-5" strokeWidth={1.75} />
        </Link>
      )}
    </RailTip>
  );
}
