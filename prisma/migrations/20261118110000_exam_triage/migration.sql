-- Doctor's exam: both-arm blood pressure, waist; structured anamnesis; triage records.
ALTER TYPE "VitalKind" ADD VALUE IF NOT EXISTS 'SYSTOLIC_BP_LEFT';
ALTER TYPE "VitalKind" ADD VALUE IF NOT EXISTS 'DIASTOLIC_BP_LEFT';
ALTER TYPE "VitalKind" ADD VALUE IF NOT EXISTS 'WAIST';

CREATE TYPE "Pregnancy" AS ENUM ('NO', 'YES', 'UNKNOWN');
CREATE TYPE "DiabetesType" AS ENUM ('NO', 'TYPE1', 'TYPE2', 'OTHER');
CREATE TYPE "SmokingStatus" AS ENUM ('NEVER', 'FORMER', 'CURRENT');
CREATE TYPE "NursingKind" AS ENUM ('FIRST_AID', 'MEDICATION', 'NOTE');

CREATE TABLE "PatientHistory" (
  "patientId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "pregnancy" "Pregnancy",
  "pregnancyWeeks" INTEGER,
  "priorMyocardialInfarction" BOOLEAN,
  "diabetes" "DiabetesType",
  "smoking" "SmokingStatus",
  "hypertensionYears" INTEGER,
  "hereditary" TEXT,
  "surgeries" TEXT,
  "otherNotes" TEXT,
  "updatedById" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientHistory_pkey" PRIMARY KEY ("patientId"),
  CONSTRAINT "PatientHistory_weeks_chk" CHECK ("pregnancyWeeks" IS NULL OR "pregnancyWeeks" BETWEEN 1 AND 45),
  CONSTRAINT "PatientHistory_htn_chk" CHECK ("hypertensionYears" IS NULL OR "hypertensionYears" BETWEEN 0 AND 100),
  CONSTRAINT "PatientHistory_text_chk" CHECK (coalesce(length("hereditary"), 0) <= 2000 AND coalesce(length("surgeries"), 0) <= 2000 AND coalesce(length("otherNotes"), 0) <= 4000)
);
CREATE INDEX "PatientHistory_tenantId_idx" ON "PatientHistory"("tenantId");
ALTER TABLE "PatientHistory" ADD CONSTRAINT "PatientHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientHistory" ADD CONSTRAINT "PatientHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "NursingRecord" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "appointmentId" UUID,
  "kind" "NursingKind" NOT NULL,
  "text" TEXT NOT NULL,
  "drug" TEXT,
  "dose" TEXT,
  "route" TEXT,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NursingRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NursingRecord_text_chk" CHECK (length("text") BETWEEN 1 AND 2000 AND coalesce(length("drug"), 0) <= 200 AND coalesce(length("dose"), 0) <= 100 AND coalesce(length("route"), 0) <= 100)
);
CREATE INDEX "NursingRecord_tenantId_patientId_recordedAt_idx" ON "NursingRecord"("tenantId", "patientId", "recordedAt");
ALTER TABLE "NursingRecord" ADD CONSTRAINT "NursingRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NursingRecord" ADD CONSTRAINT "NursingRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clinical tables: clinic role only (never platform, never portal). Nursing records are append-only.
REVOKE ALL ON "PatientHistory", "NursingRecord" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "PatientHistory" TO itopmed_app;
GRANT SELECT, INSERT ON "NursingRecord" TO itopmed_app;
ALTER TABLE "PatientHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NursingRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientHistory" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "NursingRecord" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Triage may add the tests a doctor asked for (EKG, UZI ...) to the bill; the cashier takes the money.
INSERT INTO "RolePermission" ("tenantId", "roleId", permission)
SELECT r."tenantId", r.id, v.permission FROM "Role" r
JOIN (VALUES ('nurse', 'billing.invoice'), ('nurse', 'services.read')) AS v(key, permission) ON v.key = r.key AND r."isSystem"
ON CONFLICT DO NOTHING;
