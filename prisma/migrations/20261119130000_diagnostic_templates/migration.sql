-- Clinic-defined diagnostic report templates (fields with the doctor's own normal ranges + report text)
-- and, on each result, a copy of the template used (later edits never change a past report).
ALTER TYPE "TemplateKind" ADD VALUE IF NOT EXISTS 'DIAGNOSTIC';
ALTER TABLE "DiagnosticResult" ADD COLUMN "templateSnapshot" JSONB;
ALTER TABLE "DiagnosticResult" ADD CONSTRAINT "DiagnosticResult_snapshot_chk" CHECK ("templateSnapshot" IS NULL OR jsonb_typeof("templateSnapshot") = 'object');
