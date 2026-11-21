import { getTranslations } from "next-intl/server";
import { Skeleton } from "../ui/primitives";

/**
 * Placeholder while a workspace page renders on the server: the same frame as a
 * real page (title, a row of figures, one working panel), so nothing jumps when
 * the content arrives.
 */
export async function PageSkeleton() {
  const t = await getTranslations("a11y");
  return (
    <div role="status" aria-live="polite" className="animate-rise">
      <span className="sr-only">{t("loading")}</span>
      <div className="mb-6 space-y-3 sm:mb-8">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-8 w-[min(22rem,80%)] sm:h-9" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-[var(--radius-card)] bg-surface p-4 shadow-card sm:p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-card sm:p-6">
        <Skeleton className="h-4 w-36" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
