/**
 * Diagnostic studies and their result fields. One entry per study type: adding
 * a new device or study (e.g. spirometry later) means adding its fields here,
 * a value to the DiagnosticKind enum and the labels in the message catalogs.
 * Values are entered by hand today (from the device screen or paper); the
 * same structure will receive data from connected devices later.
 *
 * Numeric limits only reject typing errors - they are not clinical norms.
 */

export const DIAGNOSTIC_KINDS = ["ECG", "ECHO", "ULTRASOUND", "HOLTER", "ABPM", "STRESS_TEST", "OTHER"] as const;
export type DiagnosticKindKey = (typeof DIAGNOSTIC_KINDS)[number];

export type DiagnosticField =
  | { key: string; type: "number"; unit: string; min: number; max: number }
  | { key: string; type: "text"; max: number };

const n = (key: string, unit: string, min: number, max: number): DiagnosticField => ({ key, type: "number", unit, min, max });
const t = (key: string, max = 300): DiagnosticField => ({ key, type: "text", max });

export const DIAGNOSTIC_FIELDS: Record<DiagnosticKindKey, DiagnosticField[]> = {
  ECG: [t("rhythm"), n("heartRate", "/min", 15, 300), t("axis", 60), n("pq", "ms", 40, 600), n("qrs", "ms", 30, 300), n("qt", "ms", 150, 800), t("st", 300)],
  ECHO: [n("lvef", "%", 5, 90), n("lvedd", "mm", 10, 120), n("lvesd", "mm", 5, 100), n("ivs", "mm", 3, 40), n("lvpw", "mm", 3, 40), n("la", "mm", 10, 100), n("aorta", "mm", 10, 80), n("rv", "mm", 5, 80), n("pasp", "mmHg", 5, 150), t("valves", 1000), t("wallMotion", 500)],
  ULTRASOUND: [t("organ", 120), t("findings", 3000)],
  HOLTER: [n("durationHours", "h", 1, 168), n("meanHr", "/min", 15, 250), n("minHr", "/min", 15, 250), n("maxHr", "/min", 15, 300), n("pvc", "", 0, 200000), n("svc", "", 0, 200000), n("pauses", "", 0, 10000), t("st", 500)],
  ABPM: [n("daySys", "mmHg", 50, 300), n("dayDia", "mmHg", 30, 200), n("nightSys", "mmHg", 50, 300), n("nightDia", "mmHg", 30, 200), t("dipping", 120)],
  STRESS_TEST: [t("protocol", 120), n("maxWorkload", "W", 0, 600), n("maxHr", "/min", 30, 260), n("maxSys", "mmHg", 50, 300), t("result", 1000)],
  OTHER: [],
};

/** Parses a form into stored values; unknown keys are ignored, bad numbers are reported by key. */
export function parseDiagnosticData(kind: DiagnosticKindKey, raw: Record<string, string>): { data: Record<string, string | number>; errors: string[] } {
  const data: Record<string, string | number> = {};
  const errors: string[] = [];
  for (const f of DIAGNOSTIC_FIELDS[kind]) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) continue;
    if (f.type === "number") {
      const x = Number(v.replace(",", "."));
      if (!Number.isFinite(x) || x < f.min || x > f.max) errors.push(f.key);
      else data[f.key] = x;
    } else if (v.length > f.max) errors.push(f.key);
    else data[f.key] = v;
  }
  return { data, errors };
}

/** Allowed attachments: what clinics actually have (photos/scans of images and device PDFs). */
export const DIAGNOSTIC_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const DIAGNOSTIC_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** The real type from the first bytes - the browser's claim is not trusted. */
export function sniffFileType(bytes: Uint8Array): (typeof DIAGNOSTIC_FILE_TYPES)[number] | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}

/** Message key of a unit (keys cannot contain "/" or "%"). */
export function unitKey(unit: string): string {
  return ({ "/min": "perMin", "%": "percent", mm: "mm", mmHg: "mmHg", ms: "ms", h: "h", W: "W" } as Record<string, string>)[unit] ?? "none";
}
