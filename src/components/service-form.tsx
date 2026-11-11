import { getTranslations } from "next-intl/server";
import { SERVICE_KINDS } from "@/server/clinic/resources";
import { minorToDecimalString } from "@/lib/money";
import { SelectField, TextField } from "./ui/form";

/** Fields shared by "add service" and "edit service". */
export async function ServiceFields({
  departments,
  initial,
}: {
  departments: { id: string; name: string }[];
  initial?: { code: string; name: string; kind: string; departmentId: string | null; durationMinutes: number; priceMinor: bigint; currency: string };
}) {
  const t = await getTranslations();
  return (
    <div className="grid gap-5 sm:grid-cols-6">
      <TextField name="code" label={t("clinic.services.code")} hint={t("clinic.services.codeHint")} defaultValue={initial?.code} required className="sm:col-span-2" />
      <TextField name="name" label={t("clinic.services.name")} defaultValue={initial?.name} required className="sm:col-span-4" />
      <SelectField name="kind" label={t("clinic.services.kind")} defaultValue={initial?.kind ?? "CONSULTATION"} options={SERVICE_KINDS.map((k) => ({ value: k, label: t(`serviceKind.${k}`) }))} className="sm:col-span-3" />
      <SelectField
        name="departmentId"
        label={t("clinic.services.department")}
        defaultValue={initial?.departmentId ?? ""}
        options={[{ value: "", label: t("clinic.services.noDepartment") }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
        className="sm:col-span-3"
      />
      <TextField name="durationMinutes" label={t("clinic.services.duration")} inputMode="numeric" defaultValue={String(initial?.durationMinutes ?? 20)} required className="sm:col-span-2" />
      <TextField name="price" label={t("clinic.services.price")} inputMode="numeric" defaultValue={initial ? minorToDecimalString(initial.priceMinor, initial.currency) : undefined} placeholder="150 000" required className="sm:col-span-2" />
      <SelectField name="currency" label={t("clinic.services.currency")} defaultValue={initial?.currency ?? "UZS"} options={[{ value: "UZS", label: "UZS" }, { value: "USD", label: "USD" }]} className="sm:col-span-2" />
    </div>
  );
}
