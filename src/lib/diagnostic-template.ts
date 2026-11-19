import { DIAGNOSTIC_KINDS, type DiagnosticKindKey } from "./diagnostics";

/**
 * Clinic-defined diagnostic report templates (UZI types, echo, ECG…).
 *
 * The clinic (its doctors) defines the fields, their units, THEIR normal
 * ranges and the report text - ITop Med ships no clinical norms of its own.
 * Fields are written one per line, columns separated by "|":
 *
 *   key | Label | unit | min-max | normal text
 *   fhr | Yurak urishi, 1 daqiqada | marta | 115-160 |
 *   movements | Harakati |  |  | me'yorda
 *
 *  - key: latin letters/digits, used as {{key}} in the report text;
 *  - min-max: optional numeric normal range (a number outside it is flagged);
 *  - normal text: optional value put in by "Fill normal".
 * The report text contains {{key}} placeholders; a line whose placeholders
 * are all empty is left out of the printed report.
 */

export interface TemplateField {
  key: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  normal?: string;
}

export interface DiagnosticTemplateContent {
  study: DiagnosticKindKey;
  fields: TemplateField[];
  body: string;
  conclusion?: string;
}

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const num = (s: string) => Number(s.trim().replace(",", "."));

/** Parses the one-line-per-field format; returns the 1-based numbers of bad lines. */
export function parseFieldLines(text: string): { fields: TemplateField[]; badLines: number[] } {
  const fields: TemplateField[] = [];
  const badLines: number[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const [key = "", label = "", unit = "", range = "", normal = ""] = line.split("|").map((c) => c.trim());
    if (!KEY.test(key) || !label || label.length > 120 || unit.length > 20 || normal.length > 300 || seen.has(key)) return badLines.push(i + 1);
    const f: TemplateField = { key, label, ...(unit ? { unit } : {}), ...(normal ? { normal } : {}) };
    if (range) {
      const m = /^\s*(-?[\d.,]+)\s*[-–]\s*(-?[\d.,]+)\s*$/.exec(range);
      if (!m || !Number.isFinite(num(m[1]!)) || !Number.isFinite(num(m[2]!)) || num(m[1]!) > num(m[2]!)) return badLines.push(i + 1);
      f.min = num(m[1]!);
      f.max = num(m[2]!);
    }
    seen.add(key);
    fields.push(f);
  });
  if (fields.length > 80) badLines.push(81);
  return { fields, badLines };
}

export function fieldLines(fields: TemplateField[]): string {
  return fields.map((f) => [f.key, f.label, f.unit ?? "", f.min !== undefined && f.max !== undefined ? `${f.min}-${f.max}` : "", f.normal ?? ""].join(" | ")).join("\n");
}

/** Placeholders in the report text that are not defined as fields. */
export function unknownPlaceholders(body: string, fields: TemplateField[]): string[] {
  const keys = new Set(fields.map((f) => f.key));
  return [...new Set([...body.matchAll(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g)].map((m) => m[1]!))].filter((k) => !keys.has(k));
}

export function parseTemplateContent(content: string): DiagnosticTemplateContent | null {
  try {
    const v = JSON.parse(content) as DiagnosticTemplateContent;
    if (!(DIAGNOSTIC_KINDS as readonly string[]).includes(v.study) || !Array.isArray(v.fields) || typeof v.body !== "string") return null;
    return v;
  } catch {
    return null;
  }
}

export type Flag = "LOW" | "HIGH" | null;

/** LOW / HIGH against the clinic's own range; text values and fields without a range are never flagged. */
export function flagOf(field: TemplateField, value: string | number | undefined): Flag {
  if (value === undefined || value === "" || field.min === undefined || field.max === undefined) return null;
  const n = typeof value === "number" ? value : num(String(value));
  if (!Number.isFinite(n)) return null;
  return n < field.min ? "LOW" : n > field.max ? "HIGH" : null;
}

/** Values entered for a template: trimmed text, numbers kept as typed (validated to be numbers when a range exists). */
export function parseTemplateValues(fields: TemplateField[], raw: Record<string, string>): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of fields) {
    const v = (raw[`f_${f.key}`] ?? "").trim();
    if (!v) continue;
    if (v.length > 1000) errors.push(f.key);
    else if (f.min !== undefined && !Number.isFinite(num(v))) errors.push(f.key);
    else values[f.key] = v;
  }
  return { values, errors };
}

/** Text of the report: placeholders replaced; lines whose placeholders are all empty are dropped. */
export function renderReport(body: string, values: Record<string, string>): { text: string; parts: { text: string; key?: string }[][] } {
  const re = /\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g;
  const lines: { text: string; key?: string }[][] = [];
  for (const line of body.split(/\r?\n/)) {
    const keys = [...line.matchAll(re)].map((m) => m[1]!);
    if (keys.length && keys.every((k) => !(values[k] ?? "").trim())) continue;
    const parts: { text: string; key?: string }[] = [];
    let last = 0;
    for (const m of line.matchAll(re)) {
      parts.push({ text: line.slice(last, m.index) });
      parts.push({ text: values[m[1]!] ?? "", key: m[1]! });
      last = m.index! + m[0].length;
    }
    parts.push({ text: line.slice(last) });
    lines.push(parts.filter((p) => p.text !== ""));
  }
  return { text: lines.map((l) => l.map((p) => p.text).join("")).join("\n"), parts: lines };
}
