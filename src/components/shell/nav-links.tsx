"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { cx } from "../ui/primitives";
import { Icon, type IconName } from "./icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match only the exact path (for section roots). */
  exact?: boolean;
  /** Id of the NavGroup this item belongs to (ungrouped items come first). */
  group?: string;
}

/** A titled section of the navigation; `collapsible` ones stay folded unless they hold the current page. */
export interface NavGroup {
  id: string;
  label: string;
  collapsible?: boolean;
  /** Rail icon of the section (desktop sections mode). */
  icon?: IconName;
}

function isActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
}

function ItemList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex h-11 items-center gap-3 rounded-full px-4 lg:h-10 text-[14px] font-medium transition-[background-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out)] active:scale-[0.98]",
                active ? "bg-accent-solid font-semibold text-on-accent" : "text-text-2 hover:bg-surface hover:text-text",
              )}
            >
              <Icon name={item.icon} className="size-[18px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const headingClass = "px-4 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3";

export function NavLinks({ items, label, groups = [] }: { items: NavItem[]; label: string; groups?: NavGroup[] }) {
  const pathname = usePathname();
  const uid = useId(); // the menu renders twice (sidebar + phone menu): ids must differ
  const known = new Set(groups.map((g) => g.id));
  const loose = items.filter((i) => !i.group || !known.has(i.group));
  return (
    <nav aria-label={label} className="space-y-5">
      {loose.length ? <ItemList items={loose} pathname={pathname} /> : null}
      {groups.map((g) => {
        const own = items.filter((i) => i.group === g.id);
        if (!own.length) return null; // a role without these pages sees no empty heading
        if (g.collapsible) {
          const holdsCurrent = own.some((i) => isActive(i, pathname));
          return (
            // key on holdsCurrent: re-opens when navigation lands inside the group.
            <details key={`${g.id}-${holdsCurrent}`} open={holdsCurrent} className="group/nav">
              <summary className={cx(headingClass, "flex h-8 cursor-pointer list-none items-center justify-between rounded-full hover:text-text [&::-webkit-details-marker]:hidden")}>
                {g.label}
                <ChevronDown aria-hidden className="size-4 transition-transform duration-[var(--dur-quick)] ease-[var(--ease-out)] group-open/nav:rotate-180" />
              </summary>
              <div className="animate-drop mt-1">
                <ItemList items={own} pathname={pathname} />
              </div>
            </details>
          );
        }
        return (
          <section key={g.id} aria-labelledby={`${uid}-${g.id}`}>
            <h2 id={`${uid}-${g.id}`} className={cx(headingClass, "mb-1")}>
              {g.label}
            </h2>
            <ItemList items={own} pathname={pathname} />
          </section>
        );
      })}
    </nav>
  );
}
