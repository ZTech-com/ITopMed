-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('PINFL', 'PASSPORT', 'BIRTH_CERTIFICATE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('SMS_REMINDERS', 'TELEGRAM_NOTIFICATIONS', 'EMAIL_NOTIFICATIONS', 'MARKETING', 'HEALTH_DATA_EXCHANGE', 'PATIENT_PORTAL');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('PAPER_SIGNED', 'VERBAL_RECORDED', 'PORTAL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('FRONT_DESK', 'PHONE', 'WALK_IN', 'PORTAL');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('PATIENT_REQUEST', 'CLINIC_RESCHEDULE', 'DOCTOR_UNAVAILABLE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'SIGNED');

-- CreateEnum
CREATE TYPE "DiagnosisKind" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "ClinicalStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VitalKind" AS ENUM ('SYSTOLIC_BP', 'DIASTOLIC_BP', 'HEART_RATE', 'RESPIRATORY_RATE', 'TEMPERATURE', 'SPO2', 'WEIGHT', 'HEIGHT', 'BLOOD_GLUCOSE');

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "mrn" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "birthDate" DATE NOT NULL,
    "sex" "Sex" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "preferredLocale" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientIdentifier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "recordedById" UUID NOT NULL,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorProfileId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "roomId" UUID,
    "serviceId" UUID,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'FRONT_DESK',
    "adminNote" TEXT,
    "queueNumber" INTEGER,
    "checkedInAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" "CancellationReason",
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorProfileId" UUID NOT NULL,
    "appointmentId" UUID,
    "branchId" UUID NOT NULL,
    "status" "EncounterStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'DRAFT',
    "complaints" TEXT NOT NULL DEFAULT '',
    "history" TEXT NOT NULL DEFAULT '',
    "examination" TEXT NOT NULL DEFAULT '',
    "assessment" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "signedAt" TIMESTAMP(3),
    "signedById" UUID,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNoteAmendment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNoteAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "icd10Code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "DiagnosisKind" NOT NULL DEFAULT 'PRIMARY',
    "status" "ClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "substance" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'UNKNOWN',
    "status" "ClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSign" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "kind" "VitalKind" NOT NULL,
    "value" DECIMAL(7,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalSign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_tenantId_lastName_firstName_idx" ON "Patient"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Patient_tenantId_birthDate_idx" ON "Patient"("tenantId", "birthDate");

-- CreateIndex
CREATE INDEX "Patient_tenantId_phone_idx" ON "Patient"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_tenantId_mrn_key" ON "Patient"("tenantId", "mrn");

-- CreateIndex
CREATE INDEX "PatientIdentifier_tenantId_patientId_idx" ON "PatientIdentifier"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientIdentifier_tenantId_type_value_key" ON "PatientIdentifier"("tenantId", "type", "value");

-- CreateIndex
CREATE INDEX "PatientConsent_tenantId_patientId_purpose_idx" ON "PatientConsent"("tenantId", "patientId", "purpose");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startsAt_idx" ON "Appointment"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_doctorProfileId_startsAt_idx" ON "Appointment"("tenantId", "doctorProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_patientId_idx" ON "Appointment"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_appointmentId_key" ON "Encounter"("appointmentId");

-- CreateIndex
CREATE INDEX "Encounter_tenantId_patientId_startedAt_idx" ON "Encounter"("tenantId", "patientId", "startedAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_tenantId_patientId_idx" ON "ClinicalNote"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "ClinicalNoteAmendment_tenantId_noteId_idx" ON "ClinicalNoteAmendment"("tenantId", "noteId");

-- CreateIndex
CREATE INDEX "Diagnosis_tenantId_patientId_idx" ON "Diagnosis"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "Allergy_tenantId_patientId_idx" ON "Allergy"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "VitalSign_tenantId_patientId_measuredAt_idx" ON "VitalSign"("tenantId", "patientId", "measuredAt");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIdentifier" ADD CONSTRAINT "PatientIdentifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIdentifier" ADD CONSTRAINT "PatientIdentifier_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNoteAmendment" ADD CONSTRAINT "ClinicalNoteAmendment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNoteAmendment" ADD CONSTRAINT "ClinicalNoteAmendment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 6 security & integrity
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Data quality -------------------------------------------------------
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mrn_chk" CHECK (mrn ~ '^P-[0-9]{6,}$');
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_email_chk" CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_locale_chk" CHECK ("preferredLocale" IS NULL OR "preferredLocale" IN ('uz-Latn','uz-Cyrl','ru','en'));
ALTER TABLE "PatientIdentifier" ADD CONSTRAINT "PatientIdentifier_pinfl_chk" CHECK (type <> 'PINFL' OR value ~ '^[0-9]{14}$');
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_time_chk" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_queue_chk" CHECK ("queueNumber" IS NULL OR "queueNumber" > 0);
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_note_chk" CHECK ("adminNote" IS NULL OR length("adminNote") <= 200);
ALTER TABLE "ClinicalNoteAmendment" ADD CONSTRAINT "Amendment_reason_chk" CHECK (length(trim(reason)) >= 5);
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_icd10_chk" CHECK ("icd10Code" ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$');

-- A doctor can never have two overlapping active appointments (race-proof).
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_overlap"
  EXCLUDE USING gist ("doctorProfileId" WITH =, tsrange("startsAt", "endsAt") WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

-- Fuzzy name search (smart search, duplicate detection).
CREATE INDEX "Patient_name_trgm" ON "Patient"
  USING gin ((lower("lastName" || ' ' || "firstName" || ' ' || coalesce("middleName", ''))) gin_trgm_ops);

-- ---------- Clinical record integrity -----------------------------------------
-- Signed notes are immutable; notes are never deleted. Corrections = amendments.
CREATE FUNCTION clinical_note_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clinical notes cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'SIGNED' THEN
    RAISE EXCEPTION 'Signed clinical notes are immutable; add an amendment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'SIGNED' AND (NEW."contentHash" IS NULL OR NEW."signedAt" IS NULL OR NEW."signedById" IS NULL) THEN
    RAISE EXCEPTION 'Signing requires signer, time and content hash';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER clinical_note_guard BEFORE UPDATE OR DELETE ON "ClinicalNote"
  FOR EACH ROW EXECUTE FUNCTION clinical_note_guard();

-- ---------- Grants: clinic role only; NOTHING for the platform role ------------
REVOKE ALL ON "Patient", "PatientIdentifier", "PatientConsent", "Appointment", "Encounter",
  "ClinicalNote", "ClinicalNoteAmendment", "Diagnosis", "Allergy", "VitalSign" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "Patient", "Appointment" TO itopmed_app;
GRANT SELECT, INSERT, DELETE ON "PatientIdentifier" TO itopmed_app;
GRANT SELECT, INSERT ON "PatientConsent" TO itopmed_app;
GRANT UPDATE ("withdrawnAt") ON "PatientConsent" TO itopmed_app;
GRANT SELECT, INSERT ON "Encounter" TO itopmed_app;
GRANT UPDATE ("status", "closedAt") ON "Encounter" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "ClinicalNote" TO itopmed_app;
GRANT SELECT, INSERT ON "ClinicalNoteAmendment", "VitalSign" TO itopmed_app;
GRANT SELECT, INSERT ON "Diagnosis", "Allergy" TO itopmed_app;
GRANT UPDATE ("status", "updatedAt") ON "Diagnosis", "Allergy" TO itopmed_app;

-- ---------- Row-Level Security --------------------------------------------------
DO $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Patient','PatientIdentifier','PatientConsent','Appointment','Encounter',
                           'ClinicalNote','ClinicalNoteAmendment','Diagnosis','Allergy','VitalSign']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $fn$;
