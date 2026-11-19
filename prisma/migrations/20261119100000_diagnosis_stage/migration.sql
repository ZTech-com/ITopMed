-- Stage / degree of a diagnosis (e.g. "II daraja", "NYHA III", "CKD G3a"), kept for statistics.
ALTER TABLE "Diagnosis" ADD COLUMN "stage" TEXT;
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_stage_chk" CHECK ("stage" IS NULL OR length("stage") BETWEEN 1 AND 120);
