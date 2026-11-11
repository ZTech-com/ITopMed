"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "../ui/primitives";
import { Icon, type IconName } from "./icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match only the exact path (for section roots). */
  exact?: boolean;
}

export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors duration-150",
                  active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-sunken hover:text-text",
                )}
              >
                <Icon name={item.icon} className="size-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
