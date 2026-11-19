import { bmi } from "./calculators";

/**
 * Tentative diagnoses offered to the doctor from data already in the record.
 * Each suggestion names the WHO ICD-10 code and the fact it is based on; it is
 * only a shortcut that fills the diagnosis form - the doctor confirms, edits
 * or ignores it. Rules are deliberately few and conservative:
 *  - office BP >= 140/90 mmHg -> I10 Essential (primary) hypertension
 *    (2023 ESH / 2024 ESC hypertension guidelines threshold; the diagnosis
 *    needs repeated measurements - the doctor decides);
 *  - BMI >= 30 kg/m2 -> E66 Obesity (WHO classification);
 *  - anamnesis: type 2 / type 1 diabetes -> E11 / E10;
 *  - anamnesis: prior myocardial infarction -> I25.2 Old myocardial infarction;
 *  - anamnesis: current smoker -> Z72.0 Tobacco use.
 * Codes are from WHO ICD-10 (2019 edition); titles are translated in the UI.
 */

export type SuggestionCode = "I10" | "E66" | "E11" | "E10" | "I25.2" | "Z72.0";
export interface Suggestion {
  code: SuggestionCode;
  reason: { key: "bp" | "bmi" | "history"; values?: Record<string, string | number> };
}

export interface SuggestInput {
  systolic?: number;
  diastolic?: number;
  systolicLeft?: number;
  diastolicLeft?: number;
  weightKg?: number;
  heightCm?: number;
  diabetes?: "NO" | "TYPE1" | "TYPE2" | "OTHER" | null;
  priorMyocardialInfarction?: boolean | null;
  smoking?: "NEVER" | "FORMER" | "CURRENT" | null;
  /** Codes already recorded (no repeat suggestions). */
  existing: string[];
}

export function suggestDiagnoses(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const has = (code: string) => i.existing.some((c) => c === code || c.startsWith(`${code}.`));
  const arms = [
    [i.systolic, i.diastolic],
    [i.systolicLeft, i.diastolicLeft],
  ].filter(([s, d]) => typeof s === "number" && typeof d === "number") as [number, number][];
  // The higher-reading arm is the reference arm.
  const high = arms.sort((a, b) => b[0] - a[0])[0];
  if (high && (high[0] >= 140 || high[1] >= 90) && !has("I10") && !has("I11") && !has("I12") && !has("I13") && !has("I15")) out.push({ code: "I10", reason: { key: "bp", values: { bp: `${high[0]}/${high[1]}` } } });
  const b = bmi({ weightKg: i.weightKg, heightCm: i.heightCm });
  if (b.ok && b.value.bmi >= 30 && !has("E66")) out.push({ code: "E66", reason: { key: "bmi", values: { bmi: b.value.bmi } } });
  if (i.diabetes === "TYPE2" && !has("E11")) out.push({ code: "E11", reason: { key: "history" } });
  if (i.diabetes === "TYPE1" && !has("E10")) out.push({ code: "E10", reason: { key: "history" } });
  if (i.priorMyocardialInfarction && !has("I25.2") && !has("I25")) out.push({ code: "I25.2", reason: { key: "history" } });
  if (i.smoking === "CURRENT" && !has("Z72.0") && !has("F17")) out.push({ code: "Z72.0", reason: { key: "history" } });
  return out;
}
