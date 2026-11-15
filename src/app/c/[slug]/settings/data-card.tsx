import { getFormatter, getTranslations } from "next-intl/server";
import { Form, SubmitButton, TextField } from "@/components/ui/form";
import { Alert, Badge, Card, CardBody, CardHeader, buttonClass } from "@/components/ui/primitives";
import type { ClinicContext } from "@/server/auth/clinic-auth";
import { getDataSettings } from "@/server/clinic/data-mode";
import { dataModeAction, patientFilesAction, syncPatientFilesAction } from "../../../data-actions";

/** Clinic settings → where the data is kept, Excel files of patients. */
export async function DataCard({ ctx }: { ctx: ClinicContext }) {
  const [t, format, d] = await Promise.all([getTranslations(), getFormatter(), getDataSettings(ctx)]);
  const s = ctx.tenant.slug;
  const isOwner = ctx.roleKeys.includes("clinic_owner");
  const canManage = ctx.permissions.has("clinic.settings.manage");
  const headDoctor = ctx.permissions.has("emr.read_all");
  const local = d.install === "local";

  const option = (value: "LOCAL" | "CONNECTED", disabled: boolean) => (
    <label className={`flex items-start gap-3 rounded-[12px] border border-border p-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="radio" name="mode" value={value} defaultChecked={d.mode === value} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-[14.5px] font-medium">{t(value === "LOCAL" ? "clinic.data.local" : "clinic.data.connected")}</span>
        <span className="block text-[13px] text-text-2">{t(value === "LOCAL" ? "clinic.data.localHint" : local ? "clinic.data.connectedHintLocal" : "clinic.data.connectedHintServer")}</span>
      </span>
    </label>
  );

  return (
    <Card className="mt-6">
      <CardHeader
        title={t("clinic.data.title")}
        description={t(local ? "clinic.data.whereLocal" : "clinic.data.whereServer")}
        action={<Badge tone={d.mode === "LOCAL" ? "success" : "accent"}>{t(d.mode === "LOCAL" ? "clinic.data.badgeLocal" : "clinic.data.badgeConnected")}</Badge>}
      />
      <CardBody className="space-y-6">
        <Form action={dataModeAction} successMessage="clinic.data.saved">
          <input type="hidden" name="$slug" value={s} />
          <fieldset disabled={!isOwner} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{t("clinic.data.title")}</legend>
            {option("LOCAL", !local)}
            {option("CONNECTED", false)}
          </fieldset>
          {!local ? <p className="text-[13px] text-text-2">{t("clinic.data.serverNote")}</p> : null}
          {isOwner && local ? <SubmitButton>{t("common.save")}</SubmitButton> : null}
          {!isOwner ? <p className="text-[13px] text-text-2">{t("clinic.policy.ownerOnly")}</p> : null}
        </Form>

        <div className="border-t border-border pt-5">
          <p className="text-[14.5px] font-medium">{t("clinic.data.filesTitle")}</p>
          <p className="mb-4 text-[13px] text-text-2">{t("clinic.data.filesHint")}</p>

          {local ? (
            headDoctor && canManage ? (
              d.filesEnabled ? (
                <div className="space-y-4">
                  <Alert tone="success" title={t("clinic.data.filesOn")}>
                    <span className="block break-all font-mono text-[13px]">{d.filesDir}</span>
                    <span className="block">{d.syncedAt ? t("clinic.data.syncedAt", { date: format.dateTime(d.syncedAt, { dateStyle: "medium", timeStyle: "short", timeZone: ctx.tenant.timezone }) }) : t("clinic.data.notSyncedYet")}</span>
                  </Alert>
                  <div className="flex flex-wrap gap-3">
                    <Form action={syncPatientFilesAction}>
                      <input type="hidden" name="$slug" value={s} />
                      <SubmitButton variant="secondary" pendingLabel={t("clinic.data.writing")}>{t("clinic.data.refresh")}</SubmitButton>
                    </Form>
                    <Form action={patientFilesAction}>
                      <input type="hidden" name="$slug" value={s} />
                      <input type="hidden" name="op" value="off" />
                      <SubmitButton variant="secondary">{t("clinic.data.turnOff")}</SubmitButton>
                    </Form>
                  </div>
                </div>
              ) : (
                <Form action={patientFilesAction}>
                  <input type="hidden" name="$slug" value={s} />
                  <TextField name="dir" label={t("clinic.data.folder")} hint={t("clinic.data.folderHint")} defaultValue={d.filesDir} />
                  <p className="text-[13px] text-text-2">{t("clinic.data.privacyNote")}</p>
                  <SubmitButton pendingLabel={t("clinic.data.writing")}>{t("clinic.data.turnOn")}</SubmitButton>
                </Form>
              )
            ) : (
              <p className="text-[13px] text-text-2">{t("clinic.data.needsHeadDoctor")}</p>
            )
          ) : (
            <p className="text-[13px] text-text-2">{t("clinic.data.filesLocalOnly")}</p>
          )}

          {headDoctor ? (
            <form method="post" action={`/c/${s}/settings/patients-export`} className="mt-4">
              <button type="submit" className={buttonClass("secondary", "md")}>
                {t("clinic.data.downloadAll")}
              </button>
              <p className="mt-2 text-[13px] text-text-2">{t("clinic.data.downloadAllHint")}</p>
            </form>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
