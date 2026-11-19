"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { NYHA_CLASSES, bmi, cha2ds2Vasc, cockcroftGault, efCategory, egfrCkdEpi2021, hasBled, interArmDifference, meanArterialPressure, qtc, type Calc, type Sex } from "@/lib/calculators";

/** Appends a phrase to a section of the note being written (same page). */
function appendTo(field: string, phrase: string) {
  const el = document.querySelector<HTMLTextAreaElement>(`textarea[name="${field}"]`);
  if (!el) return;
  const current = el.value.trimEnd();
  el.value = current ? `${current}${/[.:;,]$/.test(current) ? " " : "; "}${phrase}` : phrase;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

/** Ready-made complaints and examination phrases: one click adds the text; the doctor edits freely. */
export function QuickPhrases({ groups }: { groups: { field: string; label: string; phrases: string[] }[] }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 text-[13px] font-medium text-text-2">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.phrases.map((p) => (
              <button key={p} type="button" onClick={() => appendTo(g.field, p)} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]">
                + {p}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fills the diagnosis form on the same page (code, wording, kind) - the doctor still presses "Add". */
export function DiagnosisChips({ title, items }: { title: string; items: { code: string; text: string; hint?: string }[] }) {
  if (!items.length) return null;
  const fill = (code: string, text: string) => {
    const form = document.querySelector<HTMLElement>("[data-diagnosis-form]");
    if (!form) return;
    const set = (name: string, v: string) => {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (el) {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    set("icd10Code", code);
    set("description", text);
    form.querySelector<HTMLTextAreaElement>('[name="description"]')?.focus();
  };
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-text-2">{title}</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((d) => (
          <li key={`${d.code}|${d.text}`}>
            <button type="button" onClick={() => fill(d.code, d.text)} title={d.hint} className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-left text-[13px] hover:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]">
              {d.code ? <span className="mr-1 font-mono font-semibold">{d.code}</span> : null}
              {d.text}
              {d.hint ? <span className="block text-[11.5px] text-text-3">{d.hint}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────── Calculators ─────────────

export interface CalculatorDefaults {
  age?: number;
  sex?: Sex;
  weightKg?: number;
  heightCm?: number;
  heartRate?: number;
  systolic?: number;
  diastolic?: number;
  systolicLeft?: number;
  diabetes?: boolean;
  hypertension?: boolean;
  vascularDisease?: boolean;
}

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

function NumField({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-text-2">
        {label}
        {unit ? <span className="font-normal text-text-3"> ({unit})</span> : null}
      </span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[14px] tabular-nums focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--focus)]" />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-[13.5px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span>{label}</span>
    </label>
  );
}

function InsertButton({ show, label, line }: { show: boolean; label: string; line: string | null }) {
  return show && line ? (
    <button type="button" onClick={() => appendTo("assessment", line)} className="text-[12.5px] font-medium text-accent hover:underline">
      {label}
    </button>
  ) : null;
}

function Result<T>({ r, render, missingLabel }: { r: Calc<T>; render: (v: T) => string; missingLabel: (m: string[]) => string }) {
  return r.ok ? (
    <p className="rounded-[10px] bg-accent-soft px-3 py-2 text-[14px] font-semibold text-accent" role="status">
      {render(r.value)}
    </p>
  ) : (
    <p className="rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-text-2">{missingLabel(r.missing)}</p>
  );
}

/**
 * Clinical calculators with values taken from today's record where they
 * exist. Nothing is computed with missing inputs; "Add to conclusion" appends
 * the line (result + inputs) to the assessment section of the note.
 */
export function Calculators({ defaults, canInsert }: { defaults: CalculatorDefaults; canInsert: boolean }) {
  const t = useTranslations("calc");
  const s = (v: number | undefined) => (v === undefined ? "" : String(v));
  const [age, setAge] = useState(s(defaults.age));
  const [sex, setSex] = useState<Sex | "">(defaults.sex ?? "");
  const [weight, setWeight] = useState(s(defaults.weightKg));
  const [height, setHeight] = useState(s(defaults.heightCm));
  const [creat, setCreat] = useState("");
  const [lvef, setLvef] = useState("");
  const [qt, setQt] = useState("");
  const [hr, setHr] = useState(s(defaults.heartRate));
  const [nyha, setNyha] = useState<string>("");
  const [cv, setCv] = useState({ heartFailure: false, hypertension: Boolean(defaults.hypertension), diabetes: Boolean(defaults.diabetes), strokeTiaThromboembolism: false, vascularDisease: Boolean(defaults.vascularDisease) });
  const [hb, setHb] = useState({ uncontrolledHypertension: (defaults.systolic ?? 0) > 160, abnormalRenalFunction: false, abnormalLiverFunction: false, stroke: false, bleeding: false, labileInr: false, antiplateletOrNsaid: false, alcohol: false });

  const sx = sex || undefined;
  const r = useMemo(
    () => ({
      bmi: bmi({ weightKg: num(weight), heightCm: num(height) }),
      egfr: egfrCkdEpi2021({ creatinineUmol: num(creat), age: num(age), sex: sx }),
      cg: cockcroftGault({ creatinineUmol: num(creat), age: num(age), sex: sx, weightKg: num(weight) }),
      cha: cha2ds2Vasc({ ...cv, age: num(age), sex: sx }),
      hasbled: hasBled({ ...hb, age: num(age) }),
      ef: efCategory({ lvef: num(lvef) }),
      qtc: qtc({ qtMs: num(qt), heartRate: num(hr) }),
      map: meanArterialPressure({ systolic: defaults.systolic, diastolic: defaults.diastolic }),
      arms: interArmDifference({ rightSystolic: defaults.systolic, leftSystolic: defaults.systolicLeft }),
    }),
    [weight, height, creat, age, sx, cv, hb, lvef, qt, hr, defaults.systolic, defaults.diastolic, defaults.systolicLeft],
  );
  const missing = (m: string[]) => t("missing", { list: m.map((k) => (t.has(`field.${k}`) ? t(`field.${k}` as never) : k)).join(", ") });
  const ins = { show: canInsert, label: t("insert") };

  const lines = {
    bmi: r.bmi.ok ? t("bmiLine", { bmi: r.bmi.value.bmi, cls: t(`bmiClass.${r.bmi.value.class}`) }) : null,
    egfr: r.egfr.ok ? t("egfrLine", { egfr: r.egfr.value.egfr, stage: r.egfr.value.stage, creat: creat }) : null,
    cg: r.cg.ok ? t("cgLine", { crcl: r.cg.value.crcl }) : null,
    cha: r.cha.ok ? t("chaLine", { score: r.cha.value.score }) : null,
    hasbled: r.hasbled.ok ? t("hasbledLine", { score: r.hasbled.value.score, risk: t(r.hasbled.value.high ? "riskHigh" : "riskNotHigh") }) : null,
    ef: r.ef.ok ? t("efLine", { lvef, cat: t(`ef.${r.ef.value.category}`) }) : null,
    qtc: r.qtc.ok ? t("qtcLine", { bazett: r.qtc.value.bazett, fridericia: r.qtc.value.fridericia }) : null,
    nyha: nyha ? t("nyhaLine", { cls: nyha, text: t(`nyha.${nyha}`) }) : null,
  };

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-text-3">{t("disclaimer")}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <NumField label={t("field.age")} value={age} onChange={setAge} unit={t("unit.years")} />
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-text-2">{t("field.sex")}</span>
          <select value={sex} onChange={(e) => setSex(e.target.value as Sex | "")} className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[14px]">
            <option value="">—</option>
            <option value="MALE">{t("male")}</option>
            <option value="FEMALE">{t("female")}</option>
          </select>
        </label>
        <NumField label={t("field.weightKg")} value={weight} onChange={setWeight} unit="kg" />
        <NumField label={t("field.heightCm")} value={height} onChange={setHeight} unit={t("unit.cm")} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("bmiTitle")}</h3><InsertButton {...ins} line={lines.bmi} /></div>
        <Result r={r.bmi} render={() => lines.bmi!} missingLabel={missing} />
        {r.map.ok || r.arms.ok ? (
          <p className="text-[13px] text-text-2">
            {r.map.ok ? t("mapLine", { map: r.map.value.map }) : null}
            {r.map.ok && r.arms.ok ? " · " : null}
            {r.arms.ok ? t("armsLine", { diff: r.arms.value.difference }) : null}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("kidneyTitle")}</h3><InsertButton {...ins} line={lines.egfr} /></div>
        <div className="max-w-xs"><NumField label={t("field.creatinineUmol")} value={creat} onChange={setCreat} unit={t("unit.umol")} /></div>
        <Result r={r.egfr} render={() => lines.egfr!} missingLabel={missing} />
        <Result r={r.cg} render={() => lines.cg!} missingLabel={missing} />
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("chaTitle")}</h3><InsertButton {...ins} line={lines.cha} /></div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(Object.keys(cv) as (keyof typeof cv)[]).map((k) => (
            <Check key={k} label={t(`cha.${k}`)} checked={cv[k]} onChange={(v) => setCv({ ...cv, [k]: v })} />
          ))}
        </div>
        <Result r={r.cha} render={() => lines.cha!} missingLabel={missing} />
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("hasbledTitle")}</h3><InsertButton {...ins} line={lines.hasbled} /></div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(Object.keys(hb) as (keyof typeof hb)[]).map((k) => (
            <Check key={k} label={t(`hasbled.${k}`)} checked={hb[k]} onChange={(v) => setHb({ ...hb, [k]: v })} />
          ))}
        </div>
        <Result r={r.hasbled} render={() => lines.hasbled!} missingLabel={missing} />
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("hfTitle")}</h3><InsertButton {...ins} line={[lines.ef, lines.nyha].filter(Boolean).join("; ") || null} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label={t("field.lvef")} value={lvef} onChange={setLvef} unit="%" />
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-text-2">{t("field.nyha")}</span>
            <select value={nyha} onChange={(e) => setNyha(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[14px]">
              <option value="">—</option>
              {NYHA_CLASSES.map((c) => (
                <option key={c} value={c}>{`${c} — ${t(`nyha.${c}`)}`}</option>
              ))}
            </select>
          </label>
        </div>
        <Result r={r.ef} render={() => lines.ef!} missingLabel={missing} />
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">{t("qtcTitle")}</h3><InsertButton {...ins} line={lines.qtc} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label={t("field.qtMs")} value={qt} onChange={setQt} unit={t("unit.ms")} />
          <NumField label={t("field.heartRate")} value={hr} onChange={setHr} unit={t("unit.perMin")} />
        </div>
        <Result r={r.qtc} render={() => lines.qtc!} missingLabel={missing} />
      </section>
      <p className="text-[12px] text-text-3">{t("sources")}</p>
    </div>
  );
}
