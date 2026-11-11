"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "../ui/primitives";
import { Icon } from "./icon";
import type { NavItem } from "./nav-links";

/**
 * App-style bottom navigation on phones and tablets (the four primary screens
 * of the user's role). Respects the iOS home-indicator safe area.
 */
export function MobileTabBar({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium", active ? "text-accent" : "text-text-3")}
              >
                <Icon name={item.icon} className="size-[22px]" />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
