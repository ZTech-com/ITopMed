"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormResult } from "./ui/form";

interface Candidate {
  id: string;
  mrn: string;
  fullName: string;
  birthDate: string;
  reasons: string[];
}

/** Shown inside the registration form when possible duplicates were found. Human decides. */
export function DuplicateReview({ slug }: { slug: string }) {
  const t = useTranslations("clinic.patients");
  const state = useFormResult();
  const duplicates = (state.data?.duplicates ?? []) as Candidate[];
  const blocking = Boolean(state.data?.blocking);
  if (!duplicates.length) return null;
  return (
    <div role="alert" className="space-y-3 rounded-[14px] border border-warning/40 bg-warning-soft p-4">
      <p className="font-semibold text-warning">{t("duplicatesTitle")}</p>
      <p className="text-[14px]">{blocking ? t("duplicateBlocking") : t("duplicatesHint")}</p>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[14px] font-medium">{d.fullName}</p>
              <p className="text-[12.5px] text-text-3">
                {d.mrn} · {d.birthDate} · {d.reasons.map((r) => t(`reason_${r}` as never)).join(", ")}
              </p>
            </div>
            <Link href={`/c/${slug}/patients/${d.id}`} className="text-[14px] font-medium text-accent hover:underline">
              {t("open")}
            </Link>
          </li>
        ))}
      </ul>
      {!blocking ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] bg-surface px-3 text-[14px] font-medium">
          <input type="checkbox" name="confirmNotDuplicate" className="size-4 accent-[var(--accent)]" />
          {t("confirmNew")}
        </label>
      ) : null}
    </div>
  );
}
