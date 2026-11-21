import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Minimal className joiner (no runtime dependency). */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

// Labels stay on one line when there is room and wrap (never overflow) on narrow screens.
const base =
  "inline-flex max-w-full items-center justify-center gap-2 text-center leading-tight rounded-full font-semibold transition-[background-color,border-color,box-shadow,color,transform] duration-[var(--dur-quick)] ease-[var(--ease-out)] active:scale-[0.97] active:duration-[var(--dur-press)] disabled:pointer-events-none disabled:opacity-50 select-none";
const variants: Record<Variant, string> = {
  primary: "bg-accent-solid text-on-accent hover:bg-accent-solid-hover",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-text-2 hover:bg-sunken hover:text-text",
  danger: "bg-danger-solid text-white hover:opacity-90",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 py-1 text-[13px]",
  md: "min-h-11 px-5 py-2 text-sm",
  lg: "min-h-12 px-6 py-2.5 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(base, variants[variant], sizes[size], extra);
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    // min-w-0: as a grid/flex child a card must never grow to its content's width
    // (a wide table scrolls inside the card instead of widening the page).
    <section className={cx("min-w-0 rounded-[var(--radius-card)] border border-border bg-surface shadow-card", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 className="text-balance text-[16px] font-bold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="mt-0.5 text-pretty text-[13px] text-text-2">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

export function PageHeader({ title, description, action, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="mb-1 text-[13px] font-medium text-text-3">{eyebrow}</p> : null}
        <h1 className="text-balance text-[26px] font-extrabold leading-tight tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-[34px]">{title}</h1>
        {description ? <p className="mt-2 text-pretty text-[15px] leading-relaxed text-text-2">{description}</p> : null}
      </div>
      {/* Wraps on narrow screens instead of pushing the page wider than the phone. */}
      {action ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-text-2",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5", tones[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  ACCEPTED: "success",
  APPROVED: "success",
  COMPLETED: "success",
  SIGNED: "success",
  BOOKED: "accent",
  OPEN: "accent",
  IN_PROGRESS: "accent",
  CHECKED_IN: "warning",
  NO_SHOW: "danger",
  CANCELLED: "neutral",
  CLOSED: "neutral",
  DRAFT: "neutral",
  RESOLVED: "neutral",
  ENTERED_IN_ERROR: "neutral",
  ORDERED: "accent",
  COLLECTED: "warning",
  RESULTED: "warning",
  VERIFIED: "success",
  ISSUED: "accent",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  VOID: "neutral",
  REQUESTED: "accent",
  SUCCESS: "success",
  TRIAL: "accent",
  TRIALING: "accent",
  PENDING: "accent",
  INVITED: "accent",
  PROVISIONING: "neutral",
  SUSPENDED: "warning",
  PAST_DUE: "warning",
  EXPIRED: "neutral",
  ARCHIVED: "neutral",
  REVOKED: "neutral",
  CANCELED: "neutral",
  DISABLED: "neutral",
  REMOVED: "neutral",
  DENIED: "danger",
  FAILURE: "danger",
};

export function Alert({ tone = "accent", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-[16px] px-4 py-3 text-[14px] leading-relaxed", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-text-3">{icon}</div> : null}
      <p className="text-balance text-[15px] font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-pretty text-[14px] text-text-2">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="@container p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] font-medium text-text-2">{label}</p>
        {icon ? <span className="shrink-0 text-text-3">{icon}</span> : null}
      </div>
      {/* Size follows the card width, so large sums never leave the card; the currency may wrap below the digits. */}
      <p className="mt-3 text-[clamp(1.125rem,12cqi,2rem)] font-extrabold leading-[1.1] tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]">{value}</p>
      {hint ? <p className="mt-2 text-[12px] text-text-3">{hint}</p> : null}
    </Card>
  );
}

/** Loading placeholder block (sized by the caller); calm pulse, still under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/** Responsive table: scrolls horizontally inside its card on narrow screens. */
/**
 * Data table. On phones (`phone="cards"`, the default) every row becomes a compact
 * card — first cell as the title, the other cells wrapping below it — so nothing
 * needs sideways scrolling. Use `phone="scroll"` where columns only make sense
 * side by side (e.g. a matrix).
 */
export function Table({ children, caption, phone = "cards" }: { children: ReactNode; caption?: string; phone?: "cards" | "scroll" }) {
  return (
    // Focusable so keyboard users can scroll wide tables on narrow screens (WCAG 2.1.1).
    <div className="overflow-x-auto" tabIndex={0} role={caption ? "region" : undefined} aria-label={caption}>
      <table className={cx("w-full border-collapse text-left text-[14px] tabular-nums", phone === "cards" ? "table-cards sm:min-w-[640px]" : "min-w-[640px]")}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx("border-b border-border bg-surface-2 px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.04em] text-text-3 first:pl-6", className)}>
      {children}
    </th>
  );
}

/** `label`: shown before the value only in the phone card layout, for cells that are ambiguous without their column header (e.g. two amounts). */
export function Td({ children, className, label }: { children?: ReactNode; className?: string; label?: string }) {
  return (
    <td data-label={label} className={cx("border-b border-border px-5 py-3.5 align-middle first:pl-6", className)}>
      {children}
    </td>
  );
}

export function DescriptionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] font-medium uppercase tracking-[0.04em] text-text-3">{it.label}</dt>
          <dd className="mt-1 break-words text-[14px]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
