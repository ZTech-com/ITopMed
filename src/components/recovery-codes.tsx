"use client";

import { Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { FormState } from "@/lib/form-state";
import { Form, SubmitButton, useFormResult } from "./ui/form";
import { Alert, buttonClass } from "./ui/primitives";

/** Shows a freshly generated set exactly once (it lives only in this page's memory). */
function FreshCodes() {
  const state = useFormResult();
  const t = useTranslations("security");
  const [copied, setCopied] = useState(false);
  const codes = Array.isArray(state.data?.codes) ? (state.data.codes as string[]) : null;
  if (!state.ok || !codes) return null;
  const text = `ITop Med — ${t("recoveryTitle")}\n\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-4">
      <Alert tone="warning">{t("recoveryShownOnce")}</Alert>
      <ol aria-label={t("recoveryTitle")} className="grid grid-cols-1 gap-2 rounded-[var(--radius-control)] border border-border bg-sunken p-4 font-mono text-[15px] tracking-wider sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Copy aria-hidden className="size-4" />
          {copied ? t("copied") : t("copy")}
        </button>
        <a className={buttonClass("secondary")} href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="itopmed-recovery-codes.txt">
          <Download aria-hidden className="size-4" />
          {t("download")}
        </a>
      </div>
      <p role="status" className="sr-only">
        {copied ? t("copied") : ""}
      </p>
    </div>
  );
}

/** Generate (or replace) recovery codes. The codes are returned by the action and never stored in clear. */
export function RecoveryCodesForm({ action, issued }: { action: (s: FormState, fd: FormData) => Promise<FormState>; issued: boolean }) {
  const t = useTranslations("security");
  return (
    <Form action={action}>
      <FreshCodes />
      <SubmitButton variant={issued ? "secondary" : "primary"}>{issued ? t("regenerate") : t("generate")}</SubmitButton>
    </Form>
  );
}
