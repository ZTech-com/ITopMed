"use client";

import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormState } from "@/lib/form-state";
import { Form, SubmitButton, useFormResult } from "./ui/form";
import { buttonClass } from "./ui/primitives";

function OpenLink() {
  const state = useFormResult();
  const t = useTranslations("portal.telegram");
  const link = typeof state.data?.link === "string" ? state.data.link : null;
  if (!state.ok || !link) return null;
  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-sunken p-3 text-[14px]">
      <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
        <Send aria-hidden className="size-4" />
        {t("open")}
      </a>
      <p className="text-text-2">{t("afterOpen")}</p>
    </div>
  );
}

/** Patient connects their Telegram: a one-time link (valid 15 minutes) to the clinic's bot. */
export function TelegramConnect({ action, slug }: { action: (s: FormState, fd: FormData) => Promise<FormState>; slug: string }) {
  const t = useTranslations("portal.telegram");
  return (
    <Form action={action}>
      <input type="hidden" name="$slug" value={slug} />
      <OpenLink />
      <SubmitButton variant="secondary">{t("connect")}</SubmitButton>
    </Form>
  );
}
