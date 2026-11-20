import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { FormState } from "@/lib/form-state";
import { DENTITION, SURFACES, TOOTH_CONDITIONS, type ToothState } from "@/server/emr/dental";
import { Form, SelectField, SubmitButton } from "./ui/form";
import { cx } from "./ui/primitives";

/** Colour plus a short letter code, so the chart never relies on colour alone. */
const STYLE: Record<string, string> = {
  HEALTHY: "border-success/40 bg-success-soft text-success",
  CARIES: "border-danger bg-danger-soft text-danger",
  FILLED: "border-accent bg-accent-soft text-accent",
  CROWN: "border-warning bg-warning-soft text-warning",
  ROOT_CANAL: "border-accent bg-accent-solid text-on-accent",
  IMPLANT: "border-text-2 bg-sunken text-text",
  MISSING: "border-dashed border-border-strong bg-transparent text-text-3 line-through",
  TO_EXTRACT: "border-danger bg-danger-solid text-white",
};

function Tooth({ n, state, href, selected, description }: { n: number; state?: ToothState; href?: string; selected?: boolean; description?: string }) {
  const cls = cx(
    "flex h-14 w-full min-w-0 flex-col items-center justify-center rounded-[8px] border text-[11px] font-semibold tabular-nums transition-colors",
    state ? STYLE[state.condition] : "border-border bg-surface text-text-2",
    selected && "ring-2 ring-[var(--accent)] ring-offset-1",
  );
  const body = (
    <>
      <span>{n}</span>
      <span className="text-[10px] font-medium" aria-hidden={!state}>
        {state ? <Abbr c={state.condition} surfaces={state.surfaces} /> : "·"}
      </span>
      {/* Screen readers hear the full condition after the visible code. */}
      {description ? <span className="sr-only">{description}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} scroll={false} className={cls} aria-current={selected ? "true" : undefined}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

async function Abbr({ c, surfaces }: { c: string; surfaces: string[] }) {
  const t = await getTranslations();
  return (
    <>
      {t(`toothAbbr.${c}` as never)}
      {surfaces.length ? <span className="ml-0.5 font-normal">{surfaces.join("")}</span> : null}
    </>
  );
}

/**
 * Odontogram: upper jaw on top, lower below, patient's right on the viewer's
 * left. Scrolls horizontally on narrow phones instead of shrinking the teeth.
 */
export async function DentalChart({
  current,
  dentition,
  toothHref,
  selected,
  switchHref,
}: {
  current: Record<number, ToothState>;
  dentition: "permanent" | "primary";
  toothHref?: (n: number) => string;
  selected?: number;
  switchHref?: string;
}) {
  const t = await getTranslations();
  const rows = DENTITION[dentition];
  const cols = rows.upper.length;
  const row = (teeth: readonly number[]) => (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(34px, 1fr))` }}>
      {teeth.map((n) => (
        <Tooth
          key={n}
          n={n}
          state={current[n]}
          href={toothHref?.(n)}
          selected={selected === n}
          description={current[n] ? `, ${t(`toothCondition.${current[n].condition}` as never)}${current[n].surfaces.length ? ` (${current[n].surfaces.map((x) => t(`toothSurface.${x}` as never)).join(", ")})` : ""}` : `, ${t("dental.notRecorded")}`}
        />
      ))}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-text-2">{t(`dental.${dentition}`)}</p>
        {switchHref ? (
          <Link href={switchHref} scroll={false} className="text-[13px] font-medium text-accent hover:underline">
            {t(dentition === "permanent" ? "dental.showPrimary" : "dental.showPermanent")}
          </Link>
        ) : null}
      </div>
      {/* Focusable so keyboard users can scroll the chart on narrow screens. */}
      <div className="overflow-x-auto pb-1" tabIndex={0} role="group" aria-label={t("dental.title")}>
        <div className="min-w-[560px] space-y-2">
          <p className="text-center text-[11px] uppercase tracking-[0.06em] text-text-3">{t("dental.upper")}</p>
          {row(rows.upper)}
          <div className="border-t border-dashed border-border" />
          {row(rows.lower)}
          <p className="text-center text-[11px] uppercase tracking-[0.06em] text-text-3">{t("dental.lower")}</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-2" aria-label={t("dental.legend")}>
        {TOOTH_CONDITIONS.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className={cx("inline-grid h-5 min-w-5 place-items-center rounded border px-1 text-[10px] font-semibold", STYLE[c])}>{t(`toothAbbr.${c}` as never)}</span>
            {t(`toothCondition.${c}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Recording form for the treating doctor (works without JavaScript). */
export async function ToothForm({ action, slug, encounterId, tooth }: { action: (s: FormState, fd: FormData) => Promise<FormState>; slug: string; encounterId: string; tooth?: number }) {
  const t = await getTranslations();
  const all = [...DENTITION.permanent.upper, ...DENTITION.permanent.lower, ...DENTITION.primary.upper, ...DENTITION.primary.lower];
  return (
    <Form action={action} className="space-y-3">
      <input type="hidden" name="$slug" value={slug} />
      <input type="hidden" name="encounterId" value={encounterId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="tooth" label={t("dental.tooth")} defaultValue={tooth ? String(tooth) : "16"} options={all.map((n) => ({ value: String(n), label: String(n) }))} />
        <SelectField name="condition" label={t("dental.condition")} options={TOOTH_CONDITIONS.map((c) => ({ value: c, label: t(`toothCondition.${c}`) }))} />
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium">{t("dental.surfaces")}</legend>
        <p className="text-[12.5px] text-text-3">{t("dental.surfacesHint")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SURFACES.map((sf) => (
            <label key={sf} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 text-[13px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="surfaces" value={sf} className="size-4 accent-[var(--accent)]" />
              {t(`toothSurface.${sf}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton variant="secondary">{t("dental.record")}</SubmitButton>
    </Form>
  );
}

/** Recent chart entries (history). */
export async function DentalHistory({ history, timeZone }: { history: { id: string; tooth: number; condition: string; surfaces: string[]; recordedAt: Date }[]; timeZone: string }) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  if (history.length === 0) return <p className="text-[13px] text-text-3">{t("dental.noEntries")}</p>;
  return (
    <ul className="space-y-1 text-[13px]">
      {history.map((h) => (
        <li key={h.id} className="flex flex-wrap justify-between gap-2">
          <span>
            <span className="font-semibold tabular-nums">{h.tooth}</span> · {t(`toothCondition.${h.condition}` as never)}
            {h.surfaces.length ? ` (${h.surfaces.join("")})` : ""}
          </span>
          <span className="text-text-3">{format.dateTime(h.recordedAt, { dateStyle: "medium", timeZone })}</span>
        </li>
      ))}
    </ul>
  );
}
