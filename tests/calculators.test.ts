import { describe, expect, it } from "vitest";
import { bmi, cha2ds2Vasc, ckdStage, cockcroftGault, efCategory, egfrCkdEpi2021, hasBled, interArmDifference, meanArterialPressure, qtc } from "@/lib/calculators";

// 1.0 mg/dL and 0.7 mg/dL of creatinine in µmol/L.
const MG1 = 88.4;
const MG07 = 0.7 * 88.4;

describe("clinical calculators (published formulas)", () => {
  it("BMI with WHO classes; nothing without both values", () => {
    expect(bmi({ weightKg: 88, heightCm: 174 })).toMatchObject({ ok: true, value: { bmi: 29.1, class: "OVERWEIGHT" } });
    expect(bmi({ weightKg: 70, heightCm: 175 })).toMatchObject({ ok: true, value: { bmi: 22.9, class: "NORMAL" } });
    expect(bmi({ weightKg: 130, heightCm: 170 })).toMatchObject({ ok: true, value: { class: "OBESITY_3" } });
    expect(bmi({ weightKg: 80 })).toEqual({ ok: false, missing: ["heightCm"] });
  });

  it("CKD-EPI 2021: worked examples (50 y man, Scr 1.0 mg/dL -> 92; 60 y woman, Scr 0.7 mg/dL -> 99)", () => {
    expect(egfrCkdEpi2021({ creatinineUmol: MG1, age: 50, sex: "MALE" })).toMatchObject({ ok: true, value: { egfr: 92, stage: "G1" } });
    expect(egfrCkdEpi2021({ creatinineUmol: MG07, age: 60, sex: "FEMALE" })).toMatchObject({ ok: true, value: { egfr: 99, stage: "G1" } });
    // Higher creatinine lowers eGFR; stages follow KDIGO.
    const r = egfrCkdEpi2021({ creatinineUmol: 2 * MG1, age: 70, sex: "MALE" });
    expect(r.ok && r.value.egfr).toBeLessThan(45);
    expect([ckdStage(95), ckdStage(60), ckdStage(59), ckdStage(44), ckdStage(29), ckdStage(14)]).toEqual(["G1", "G2", "G3a", "G3b", "G4", "G5"]);
    expect(egfrCkdEpi2021({ creatinineUmol: MG1, sex: "MALE" })).toEqual({ ok: false, missing: ["age"] });
    expect(egfrCkdEpi2021({ creatinineUmol: MG1, age: 15, sex: "MALE" }).ok).toBe(false);
  });

  it("Cockcroft-Gault: (140-60) x 72 / (72 x 1.0) = 80 mL/min; women x 0.85", () => {
    expect(cockcroftGault({ creatinineUmol: MG1, age: 60, sex: "MALE", weightKg: 72 })).toMatchObject({ ok: true, value: { crcl: 80 } });
    expect(cockcroftGault({ creatinineUmol: MG1, age: 60, sex: "FEMALE", weightKg: 72 })).toMatchObject({ ok: true, value: { crcl: 68 } });
  });

  it("CHA2DS2-VASc and HAS-BLED point tables", () => {
    const base = { heartFailure: false, hypertension: false, diabetes: false, strokeTiaThromboembolism: false, vascularDisease: false };
    expect(cha2ds2Vasc({ ...base, age: 50, sex: "MALE" })).toMatchObject({ value: { score: 0 } });
    expect(cha2ds2Vasc({ ...base, age: 76, sex: "FEMALE", hypertension: true })).toMatchObject({ value: { score: 4 } });
    expect(cha2ds2Vasc({ heartFailure: true, hypertension: true, diabetes: true, strokeTiaThromboembolism: true, vascularDisease: true, age: 80, sex: "FEMALE" })).toMatchObject({ value: { score: 9 } });
    expect(cha2ds2Vasc({ age: 70 }).ok).toBe(false);
    const hb = { uncontrolledHypertension: true, abnormalRenalFunction: false, abnormalLiverFunction: false, stroke: false, bleeding: true, labileInr: false, age: 70, antiplateletOrNsaid: false, alcohol: false };
    expect(hasBled(hb)).toMatchObject({ value: { score: 3, high: true } });
    expect(hasBled({ ...hb, bleeding: false })).toMatchObject({ value: { score: 2, high: false } });
  });

  it("LVEF categories (ESC 2021), QTc, MAP, inter-arm difference", () => {
    expect([40, 41, 49, 50].map((lvef) => (efCategory({ lvef }) as { value: { category: string } }).value.category)).toEqual(["HFrEF", "HFmrEF", "HFmrEF", "HFpEF"]);
    expect(efCategory({}).ok).toBe(false);
    expect(qtc({ qtMs: 400, heartRate: 60 })).toMatchObject({ value: { bazett: 400, fridericia: 400 } });
    expect(qtc({ qtMs: 360, heartRate: 100 })).toMatchObject({ value: { bazett: 465, fridericia: 427 } });
    expect(meanArterialPressure({ systolic: 120, diastolic: 80 })).toMatchObject({ value: { map: 93 } });
    expect(interArmDifference({ rightSystolic: 150, leftSystolic: 135 })).toMatchObject({ value: { difference: 15 } });
  });
});
