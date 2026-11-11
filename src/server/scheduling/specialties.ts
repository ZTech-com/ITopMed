/**
 * Medical specialties offered in the doctor profile. Keys are stable; labels
 * are translated in messages/*.json under `specialties`. To be reviewed with
 * the clinical advisor against the Ministry of Health nomenclature.
 */
export const SPECIALTIES = [
  "general_practice",
  "therapy",
  "pediatrics",
  "cardiology",
  "neurology",
  "gastroenterology",
  "endocrinology",
  "obstetrics_gynecology",
  "urology",
  "dermatology",
  "ophthalmology",
  "otorhinolaryngology",
  "orthopedics_traumatology",
  "surgery",
  "dentistry",
  "psychiatry",
  "pulmonology",
  "nephrology",
  "oncology",
  "radiology",
  "laboratory_medicine",
  "physiotherapy",
  "other",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export function isSpecialty(v: unknown): v is Specialty {
  return typeof v === "string" && (SPECIALTIES as readonly string[]).includes(v);
}
