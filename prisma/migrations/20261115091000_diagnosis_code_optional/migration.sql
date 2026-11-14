-- Doctors often write the diagnosis as text first ("Gipertoniya kasalligi III bosqich ...").
-- The ICD-10 code becomes optional: empty, or a well-formed code as before.
ALTER TABLE "Diagnosis" DROP CONSTRAINT "Diagnosis_icd10_chk";
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_icd10_chk" CHECK ("icd10Code" = '' OR "icd10Code" ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$');
