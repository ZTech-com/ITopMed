/**
 * Clinical calculators. Pure functions: no I/O, usable on the server and in
 * the browser, unit-tested against published worked examples.
 *
 * Every calculator returns either a result with the inputs it used, or the
 * list of missing inputs - it never guesses a missing value. Results support
 * the doctor; the clinical decision is the doctor's.
 *
 * Sources (formulas and cut-offs exactly as published):
 *  - BMI and its classes: WHO, "Obesity: preventing and managing the global epidemic",
 *    Technical Report Series 894 (2000).
 *  - eGFR: CKD-EPI 2021 creatinine equation without race - Inker LA et al.,
 *    N Engl J Med 2021;385:1737-1749. Stages G1-G5: KDIGO 2012 CKD guideline.
 *  - Creatinine clearance: Cockcroft DW, Gault MH. Nephron 1976;16:31-41.
 *  - CHA2DS2-VASc: Lip GYH et al., Chest 2010;137:263-272.
 *  - HAS-BLED: Pisters R et al., Chest 2010;138:1093-1100 (score >= 3 = high bleeding risk).
 *  - LVEF categories: 2021 ESC Guidelines for heart failure, Eur Heart J 2021;42:3599-3726
 *    (HFrEF <= 40 %, HFmrEF 41-49 %, HFpEF >= 50 %).
 *  - NYHA functional classes: The Criteria Committee of the New York Heart Association, 9th ed. (1994).
 *  - QTc: Bazett HC, Heart 1920;7:353-370; Fridericia LS, Acta Med Scand 1920;53:469-486.
 *  - Mean arterial pressure: DBP + (SBP - DBP) / 3 (standard approximation).
 */

export type Sex = "MALE" | "FEMALE";
export type Calc<T> = { ok: true; value: T; used: Record<string, string | number | boolean> } | { ok: false; missing: string[] };

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const has = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function need(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, v]) => v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v)))
    .map(([k]) => k);
}

// ───────────── BMI ─────────────

export type BmiClass = "UNDERWEIGHT" | "NORMAL" | "OVERWEIGHT" | "OBESITY_1" | "OBESITY_2" | "OBESITY_3";

export function bmi(i: { weightKg?: number; heightCm?: number }): Calc<{ bmi: number; class: BmiClass }> {
  const missing = need({ weightKg: i.weightKg, heightCm: i.heightCm });
  if (missing.length) return { ok: false, missing };
  const m = i.heightCm! / 100;
  if (m <= 0 || i.weightKg! <= 0) return { ok: false, missing: ["heightCm"] };
  const v = i.weightKg! / (m * m);
  const cls: BmiClass = v < 18.5 ? "UNDERWEIGHT" : v < 25 ? "NORMAL" : v < 30 ? "OVERWEIGHT" : v < 35 ? "OBESITY_1" : v < 40 ? "OBESITY_2" : "OBESITY_3";
  return { ok: true, value: { bmi: round(v), class: cls }, used: { weightKg: i.weightKg!, heightCm: i.heightCm! } };
}

// ───────────── Kidney ─────────────

/** µmol/L -> mg/dL (creatinine molar mass 113.12 g/mol; the conventional factor is 88.4). */
export const creatinineUmolToMgDl = (umol: number) => umol / 88.4;

export type CkdStage = "G1" | "G2" | "G3a" | "G3b" | "G4" | "G5";

export function ckdStage(egfr: number): CkdStage {
  return egfr >= 90 ? "G1" : egfr >= 60 ? "G2" : egfr >= 45 ? "G3a" : egfr >= 30 ? "G3b" : egfr >= 15 ? "G4" : "G5";
}

/** CKD-EPI 2021 (adults, standardized creatinine in µmol/L). mL/min/1.73 m². */
export function egfrCkdEpi2021(i: { creatinineUmol?: number; age?: number; sex?: Sex }): Calc<{ egfr: number; stage: CkdStage }> {
  const missing = need({ creatinineUmol: i.creatinineUmol, age: i.age, sex: i.sex });
  if (missing.length) return { ok: false, missing };
  if (i.age! < 18) return { ok: false, missing: ["age>=18"] };
  const scr = creatinineUmolToMgDl(i.creatinineUmol!);
  const female = i.sex === "FEMALE";
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const v = 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** i.age! * (female ? 1.012 : 1);
  const egfr = Math.round(v);
  return { ok: true, value: { egfr, stage: ckdStage(egfr) }, used: { creatinineUmol: i.creatinineUmol!, age: i.age!, sex: i.sex! } };
}

/** Cockcroft-Gault creatinine clearance, mL/min (actual body weight). */
export function cockcroftGault(i: { creatinineUmol?: number; age?: number; sex?: Sex; weightKg?: number }): Calc<{ crcl: number }> {
  const missing = need({ creatinineUmol: i.creatinineUmol, age: i.age, sex: i.sex, weightKg: i.weightKg });
  if (missing.length) return { ok: false, missing };
  const scr = creatinineUmolToMgDl(i.creatinineUmol!);
  const v = ((140 - i.age!) * i.weightKg! * (i.sex === "FEMALE" ? 0.85 : 1)) / (72 * scr);
  return { ok: true, value: { crcl: Math.round(v) }, used: { creatinineUmol: i.creatinineUmol!, age: i.age!, sex: i.sex!, weightKg: i.weightKg! } };
}

// ───────────── Atrial fibrillation ─────────────

export interface Cha2ds2VascInput {
  age?: number;
  sex?: Sex;
  heartFailure?: boolean;
  hypertension?: boolean;
  diabetes?: boolean;
  strokeTiaThromboembolism?: boolean;
  vascularDisease?: boolean;
}

export function cha2ds2Vasc(i: Cha2ds2VascInput): Calc<{ score: number }> {
  const missing = need({ age: i.age, sex: i.sex, heartFailure: i.heartFailure, hypertension: i.hypertension, diabetes: i.diabetes, strokeTiaThromboembolism: i.strokeTiaThromboembolism, vascularDisease: i.vascularDisease });
  if (missing.length) return { ok: false, missing };
  const score =
    (i.heartFailure ? 1 : 0) +
    (i.hypertension ? 1 : 0) +
    (i.age! >= 75 ? 2 : i.age! >= 65 ? 1 : 0) +
    (i.diabetes ? 1 : 0) +
    (i.strokeTiaThromboembolism ? 2 : 0) +
    (i.vascularDisease ? 1 : 0) +
    (i.sex === "FEMALE" ? 1 : 0);
  return { ok: true, value: { score }, used: { ...(i as Record<string, string | number | boolean>) } };
}

export interface HasBledInput {
  uncontrolledHypertension?: boolean; // systolic > 160 mmHg
  abnormalRenalFunction?: boolean;
  abnormalLiverFunction?: boolean;
  stroke?: boolean;
  bleeding?: boolean;
  labileInr?: boolean;
  age?: number; // elderly: > 65
  antiplateletOrNsaid?: boolean;
  alcohol?: boolean; // >= 8 drinks a week
}

export function hasBled(i: HasBledInput): Calc<{ score: number; high: boolean }> {
  const missing = need({ ...i });
  if (missing.length) return { ok: false, missing };
  const score =
    (i.uncontrolledHypertension ? 1 : 0) +
    (i.abnormalRenalFunction ? 1 : 0) +
    (i.abnormalLiverFunction ? 1 : 0) +
    (i.stroke ? 1 : 0) +
    (i.bleeding ? 1 : 0) +
    (i.labileInr ? 1 : 0) +
    (i.age! > 65 ? 1 : 0) +
    (i.antiplateletOrNsaid ? 1 : 0) +
    (i.alcohol ? 1 : 0);
  return { ok: true, value: { score, high: score >= 3 }, used: { ...(i as Record<string, string | number | boolean>) } };
}

// ───────────── Heart failure ─────────────

export type EfCategory = "HFrEF" | "HFmrEF" | "HFpEF";

export function efCategory(i: { lvef?: number }): Calc<{ category: EfCategory }> {
  if (!has(i.lvef)) return { ok: false, missing: ["lvef"] };
  if (i.lvef < 5 || i.lvef > 90) return { ok: false, missing: ["lvef"] };
  const category: EfCategory = i.lvef <= 40 ? "HFrEF" : i.lvef < 50 ? "HFmrEF" : "HFpEF";
  return { ok: true, value: { category }, used: { lvef: i.lvef } };
}

export const NYHA_CLASSES = ["I", "II", "III", "IV"] as const;
export type NyhaClass = (typeof NYHA_CLASSES)[number];

// ───────────── ECG / haemodynamics ─────────────

export function qtc(i: { qtMs?: number; heartRate?: number }): Calc<{ bazett: number; fridericia: number; rrSeconds: number }> {
  const missing = need({ qtMs: i.qtMs, heartRate: i.heartRate });
  if (missing.length) return { ok: false, missing };
  if (i.heartRate! <= 0) return { ok: false, missing: ["heartRate"] };
  const rr = 60 / i.heartRate!;
  return { ok: true, value: { bazett: Math.round(i.qtMs! / Math.sqrt(rr)), fridericia: Math.round(i.qtMs! / Math.cbrt(rr)), rrSeconds: round(rr, 3) }, used: { qtMs: i.qtMs!, heartRate: i.heartRate! } };
}

export function meanArterialPressure(i: { systolic?: number; diastolic?: number }): Calc<{ map: number }> {
  const missing = need({ systolic: i.systolic, diastolic: i.diastolic });
  if (missing.length) return { ok: false, missing };
  return { ok: true, value: { map: Math.round(i.diastolic! + (i.systolic! - i.diastolic!) / 3) }, used: { systolic: i.systolic!, diastolic: i.diastolic! } };
}

/** Systolic difference between the arms (the doctor interprets it). */
export function interArmDifference(i: { rightSystolic?: number; leftSystolic?: number }): Calc<{ difference: number }> {
  const missing = need({ rightSystolic: i.rightSystolic, leftSystolic: i.leftSystolic });
  if (missing.length) return { ok: false, missing };
  return { ok: true, value: { difference: Math.abs(i.rightSystolic! - i.leftSystolic!) }, used: { rightSystolic: i.rightSystolic!, leftSystolic: i.leftSystolic! } };
}
