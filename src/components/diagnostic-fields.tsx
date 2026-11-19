"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DIAGNOSTIC_FIELDS, DIAGNOSTIC_KINDS, unitKey, type DiagnosticKindKey } from "@/lib/diagnostics";

const input = "h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[14px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--focus)]";

/**
 * The fields of the chosen study (ECG, echo, ultrasound…), inside a server-action
 * form. Title defaults to the study name; numbers are validated on the server.
 */
export function DiagnosticFields() {
  const t = useTranslations("diagnostics");
  const [kind, setKind] = useState<DiagnosticKindKey>("ECG");
  const [title, setTitle] = useState<string>(t("kind.ECG"));
  const [touched, setTouched] = useState(false);
  const choose = (k: DiagnosticKindKey) => {
    setKind(k);
    if (!touched) setTitle(t(`kind.${k}`));
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">{t("kindLabel")}</span>
          <select name="kind" value={kind} onChange={(e) => choose(e.target.value as DiagnosticKindKey)} className={input}>
            {DIAGNOSTIC_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">{t("title")}</span>
          <input
            name="title"
            value={title}
            onChange={(e) => {
              setTouched(true);
              setTitle(e.target.value);
            }}
            maxLength={120}
            required
            className={input}
          />
        </label>
      </div>
      {DIAGNOSTIC_FIELDS[kind].length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {DIAGNOSTIC_FIELDS[kind].map((f) => (
            <label key={`${kind}-${f.key}`} className={`block min-w-0 ${f.type === "text" && f.max > 300 ? "sm:col-span-3" : ""}`}>
              <span className="mb-1 block text-[12.5px] font-medium text-text-2">
                {t(`field.${f.key}`)}
                {f.type === "number" && f.unit ? <span className="font-normal text-text-3"> ({t(`unit.${unitKey(f.unit)}`)})</span> : null}
              </span>
              {f.type === "text" && f.max > 300 ? (
                <textarea name={f.key} rows={2} maxLength={f.max} className="w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-[14px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--focus)]" />
              ) : (
                <input name={f.key} inputMode={f.type === "number" ? "decimal" : undefined} maxLength={f.type === "text" ? f.max : 12} className={input} />
              )}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
