import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Form, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { ButtonLink, Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui/primitives";
import { requireClinic } from "@/server/auth/guards";
import { PLACEHOLDERS, getTemplate, parseNoteContent } from "@/server/clinic/templates";
import { NOTE_SECTIONS } from "@/server/emr/record";
import { DomainError } from "@/server/errors";
import { SPECIALTIES } from "@/server/scheduling/specialties";
import { archiveTemplateAction, saveTemplateAction } from "../../../../practice-actions";

/** Create (`/templates/new?kind=…`) or edit a template. */
export default async function TemplateEditPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireClinic(slug, "clinic.settings.read");
  const canManage = ctx.permissions.has("clinic.settings.manage");
  const t = await getTranslations();
  const isNew = id === "new";
  if (isNew && !canManage) notFound();
  const template = isNew
    ? null
    : await getTemplate(ctx, id).catch((e) => {
        if (e instanceof DomainError) notFound();
        throw e;
      });
  const kind = template?.kind ?? ((await searchParams).kind === "NOTE" ? "NOTE" : "DOCUMENT");
  const note = template && kind === "NOTE" ? parseNoteContent(template.content) : null;
  const back = `/c/${ctx.tenant.slug}/templates`;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        eyebrow={t("templates.title")}
        title={isNew ? t(kind === "NOTE" ? "templates.newNote" : "templates.newDocument") : template!.name}
        action={<ButtonLink href={back} variant="secondary">{t("templates.back")}</ButtonLink>}
      />
      <Card>
        <CardBody>
          <Form action={saveTemplateAction}>
            <input type="hidden" name="$slug" value={ctx.tenant.slug} />
            <input type="hidden" name="id" value={isNew ? "" : template!.id} />
            <input type="hidden" name="kind" value={kind} />
            <fieldset disabled={!canManage} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="name" label={t("templates.name")} defaultValue={template?.name} required />
                <SelectField
                  name="specialty"
                  label={t("templates.specialty")}
                  defaultValue={template?.specialty ?? ""}
                  options={[{ value: "", label: t("templates.allSpecialties") }, ...SPECIALTIES.map((x) => ({ value: x, label: t(`specialties.${x}`) }))]}
                />
              </div>
              {kind === "DOCUMENT" ? (
                <>
                  <TextAreaField name="body" label={t("templates.body")} rows={14} defaultValue={template?.content} />
                  <details className="rounded-[var(--radius-control)] border border-border bg-sunken p-3 text-[13px]" open={isNew}>
                    <summary className="cursor-pointer font-medium">{t("templates.placeholders")}</summary>
                    <p className="mt-2 text-text-2">{t("templates.placeholdersHint")}</p>
                    <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {PLACEHOLDERS.map((p) => (
                        <li key={p} className="min-w-0">
                          <code className="select-all font-mono text-[12.5px]">{`{{${p}}}`}</code> <span className="text-text-2">— {t(`templates.ph.${p.replace(".", "_")}` as never)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                NOTE_SECTIONS.map((s) => <TextAreaField key={s} name={s} label={t(`noteSection.${s}`)} rows={3} defaultValue={note?.[s]} />)
              )}
            </fieldset>
            {canManage ? <SubmitButton>{t("common.save")}</SubmitButton> : null}
          </Form>
        </CardBody>
      </Card>
      {canManage && !isNew ? (
        <Card>
          <CardHeader title={t("templates.archiveTitle")} description={t("templates.archiveHint")} />
          <CardBody>
            <Form action={archiveTemplateAction} className="space-y-0">
              <input type="hidden" name="$slug" value={ctx.tenant.slug} />
              <input type="hidden" name="id" value={template!.id} />
              <button className={buttonClass("danger")}>{t("templates.archive")}</button>
            </Form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
