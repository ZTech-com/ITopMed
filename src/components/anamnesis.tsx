import { getTranslations } from "next-intl/server";
import type { PatientHistory } from "@/generated/prisma/client";
import type { FormState } from "@/lib/form-state";
import { Form, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { DescriptionList } from "@/components/ui/primitives";

/** Structured anamnesis: read-only summary, plus the form for clinical staff who may write. */
export async function Anamnesis({
  history,
  canEdit,
  action,
  slug,
  patientId,
  back,
  female,
}: {
  history: PatientHistory | null;
  canEdit: boolean;
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  slug: string;
  patientId: string;
  back: string;
  female: boolean;
}) {
  const t = await getTranslations("anamnesis");
  const h = history;
  const yn = (v: boolean | null | undefined) => (v === true ? t("yes") : v === false ? t("no") : "—");
  const items = h
    ? [
        ...(female ? [{ label: t("pregnancy"), value: h.pregnancy ? `${t(`pregnancyV.${h.pregnancy}`)}${h.pregnancyWeeks ? ` · ${h.pregnancyWeeks}` : ""}` : "—" }] : []),
        { label: t("priorMi"), value: yn(h.priorMyocardialInfarction) },
        { label: t("diabetes"), value: h.diabetes ? t(`diabetesV.${h.diabetes}`) : "—" },
        { label: t("smoking"), value: h.smoking ? t(`smokingV.${h.smoking}`) : "—" },
        { label: t("htnYears"), value: h.hypertensionYears ?? "—" },
        { label: t("hereditary"), value: h.hereditary ?? "—" },
        { label: t("surgeries"), value: h.surgeries ?? "—" },
        ...(h.otherNotes ? [{ label: t("other"), value: h.otherNotes }] : []),
      ]
    : [];
  const choice = (name: string, values: string[], prefix: string, current: string | null | undefined) => (
    <SelectField name={name} label={t(name === "priorMyocardialInfarction" ? "priorMi" : (name as never))} defaultValue={current ?? ""} options={[{ value: "", label: "—" }, ...values.map((v) => ({ value: v, label: prefix ? t(`${prefix}.${v}` as never) : v }))]} />
  );

  return (
    <div className="space-y-4">
      {h ? <DescriptionList items={items} /> : <p className="text-[14px] text-text-2">{t("notFilled")}</p>}
      {canEdit ? (
        <details className={h ? "border-t border-border pt-4" : undefined} open={!h}>
          <summary className="cursor-pointer text-[14px] font-medium text-accent">{t("save")}</summary>
          <Form action={action} className="mt-3">
            <input type="hidden" name="$slug" value={slug} />
            <input type="hidden" name="$back" value={back} />
            <input type="hidden" name="patientId" value={patientId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField name="priorMyocardialInfarction" label={t("priorMi")} defaultValue={h?.priorMyocardialInfarction === true ? "yes" : h?.priorMyocardialInfarction === false ? "no" : ""} options={[{ value: "", label: "—" }, { value: "yes", label: t("yes") }, { value: "no", label: t("no") }]} />
              {choice("diabetes", ["NO", "TYPE1", "TYPE2", "OTHER"], "diabetesV", h?.diabetes)}
              {choice("smoking", ["NEVER", "FORMER", "CURRENT"], "smokingV", h?.smoking)}
              <TextField name="hypertensionYears" label={t("htnYears")} inputMode="numeric" defaultValue={h?.hypertensionYears?.toString() ?? ""} />
              {female ? (
                <>
                  {choice("pregnancy", ["NO", "YES", "UNKNOWN"], "pregnancyV", h?.pregnancy)}
                  <TextField name="pregnancyWeeks" label={t("pregnancyWeeks")} inputMode="numeric" defaultValue={h?.pregnancyWeeks?.toString() ?? ""} />
                </>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextAreaField name="hereditary" label={t("hereditary")} rows={2} defaultValue={h?.hereditary ?? ""} />
              <TextAreaField name="surgeries" label={t("surgeries")} rows={2} defaultValue={h?.surgeries ?? ""} />
            </div>
            <TextAreaField name="otherNotes" label={t("other")} rows={2} defaultValue={h?.otherNotes ?? ""} />
            <SubmitButton variant="secondary">{t("save")}</SubmitButton>
          </Form>
        </details>
      ) : null}
    </div>
  );
}
