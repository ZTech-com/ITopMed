-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "discountReason" TEXT;

-- CreateTable
CREATE TABLE "ClinicPolicy" (
    "tenantId" UUID NOT NULL,
    "maxDiscountPercent" INTEGER NOT NULL DEFAULT 100,
    "discountReasonRequired" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicPolicy_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "prescribedById" UUID NOT NULL,
    "drug" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "route" TEXT,
    "durationDays" INTEGER,
    "instructions" TEXT,
    "allergyOverride" BOOLEAN NOT NULL DEFAULT false,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prescription_tenantId_patientId_idx" ON "Prescription"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "Prescription_encounterId_idx" ON "Prescription"("encounterId");

-- AddForeignKey
ALTER TABLE "ClinicPolicy" ADD CONSTRAINT "ClinicPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Clinic control policy, prescriptions, rescheduling — security
-- ============================================================================
ALTER TABLE "ClinicPolicy" ADD CONSTRAINT "ClinicPolicy_discount_chk" CHECK ("maxDiscountPercent" BETWEEN 0 AND 100);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_discountReason_chk" CHECK ("discountReason" IS NULL OR char_length("discountReason") BETWEEN 3 AND 300);
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_rescheduleCount_chk" CHECK ("rescheduleCount" >= 0);

-- Clinic policy: the clinic reads and writes its own row; platform staff may read it (no clinical content).
REVOKE ALL ON "ClinicPolicy" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "ClinicPolicy" TO itopmed_app;
GRANT SELECT ON "ClinicPolicy" TO itopmed_platform;
ALTER TABLE "ClinicPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClinicPolicy" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY platform_read ON "ClinicPolicy" FOR SELECT TO itopmed_platform USING (true);

-- Prescriptions are clinical data: clinic role only, never the platform role.
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_text_chk" CHECK (
  char_length("drug") BETWEEN 2 AND 200 AND char_length("dose") BETWEEN 1 AND 100 AND char_length("frequency") BETWEEN 1 AND 120
  AND ("route" IS NULL OR char_length("route") <= 60) AND ("instructions" IS NULL OR char_length("instructions") <= 1000)
  AND ("durationDays" IS NULL OR "durationDays" BETWEEN 1 AND 3650));
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_cancel_chk" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
REVOKE ALL ON "Prescription" FROM PUBLIC;
GRANT SELECT, INSERT ON "Prescription" TO itopmed_app;
GRANT UPDATE ("status", "cancelledAt", "cancelledById") ON "Prescription" TO itopmed_app;
ALTER TABLE "Prescription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Prescription" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- A prescription is never edited: the only allowed change is ACTIVE → CANCELLED, once.
CREATE FUNCTION prescription_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'prescriptions cannot be deleted'; END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'CANCELLED' THEN RAISE EXCEPTION 'prescriptions can only be cancelled once'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER prescription_guard BEFORE UPDATE OR DELETE ON "Prescription" FOR EACH ROW EXECUTE FUNCTION prescription_guard();
