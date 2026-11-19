-- Diagnostic results (ECG, echo, ultrasound, Holter, ABPM, stress test…) with attached files;
-- conclusion details: next visit, intake times, doctor's contact.
CREATE TYPE "DiagnosticKind" AS ENUM ('ECG', 'ECHO', 'ULTRASOUND', 'HOLTER', 'ABPM', 'STRESS_TEST', 'OTHER');

CREATE TABLE "DiagnosticResult" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "encounterId" UUID,
  "kind" "DiagnosticKind" NOT NULL,
  "title" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "conclusion" TEXT NOT NULL,
  "performedById" UUID NOT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enteredInErrorAt" TIMESTAMP(3),
  CONSTRAINT "DiagnosticResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiagnosticResult_text_chk" CHECK (length("title") BETWEEN 1 AND 120 AND length("conclusion") <= 10000 AND jsonb_typeof("data") = 'object')
);
CREATE INDEX "DiagnosticResult_tenantId_patientId_performedAt_idx" ON "DiagnosticResult"("tenantId", "patientId", "performedAt");
CREATE INDEX "DiagnosticResult_encounterId_idx" ON "DiagnosticResult"("encounterId");
ALTER TABLE "DiagnosticResult" ADD CONSTRAINT "DiagnosticResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticResult" ADD CONSTRAINT "DiagnosticResult_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DiagnosticFile" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "resultId" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "uploadedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagnosticFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiagnosticFile_chk" CHECK ("sizeBytes" BETWEEN 1 AND 10485760 AND "mimeType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') AND length("fileName") BETWEEN 1 AND 200)
);
CREATE INDEX "DiagnosticFile_tenantId_resultId_idx" ON "DiagnosticFile"("tenantId", "resultId");
ALTER TABLE "DiagnosticFile" ADD CONSTRAINT "DiagnosticFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticFile" ADD CONSTRAINT "DiagnosticFile_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "DiagnosticResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Encounter" ADD COLUMN "nextVisitDate" DATE;
ALTER TABLE "Prescription" ADD COLUMN "times" TEXT;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_times_chk" CHECK ("times" IS NULL OR length("times") <= 100);
ALTER TABLE "DoctorProfile" ADD COLUMN "contactPhone" TEXT, ADD COLUMN "contactTelegram" TEXT;

-- Clinical tables: clinic role only (never platform, never portal). Results are kept; a wrong one
-- is marked "entered in error" (the only column that can change). Files are never changed.
REVOKE ALL ON "DiagnosticResult", "DiagnosticFile" FROM PUBLIC;
GRANT SELECT, INSERT ON "DiagnosticResult", "DiagnosticFile" TO itopmed_app;
GRANT UPDATE ("enteredInErrorAt") ON "DiagnosticResult" TO itopmed_app;
ALTER TABLE "DiagnosticResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiagnosticFile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiagnosticResult" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "DiagnosticFile" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- The doctor sets the next visit on an open encounter (column-level, like status / closedAt).
GRANT UPDATE ("nextVisitDate") ON "Encounter" TO itopmed_app;
