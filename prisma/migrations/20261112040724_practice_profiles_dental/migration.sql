-- CreateEnum
CREATE TYPE "PracticeType" AS ENUM ('MULTI_SPECIALTY', 'SOLO_PRACTICE', 'DENTAL', 'DIAGNOSTIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ToothCondition" AS ENUM ('HEALTHY', 'CARIES', 'FILLED', 'CROWN', 'ROOT_CANAL', 'IMPLANT', 'MISSING', 'TO_EXTRACT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "practiceType" "PracticeType" NOT NULL DEFAULT 'MULTI_SPECIALTY',
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DentalChartEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "tooth" INTEGER NOT NULL,
    "surfaces" TEXT[],
    "condition" "ToothCondition" NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DentalChartEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DentalChartEntry_tenantId_patientId_tooth_recordedAt_idx" ON "DentalChartEntry"("tenantId", "patientId", "tooth", "recordedAt");

-- AddForeignKey
ALTER TABLE "DentalChartEntry" ADD CONSTRAINT "DentalChartEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartEntry" ADD CONSTRAINT "DentalChartEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartEntry" ADD CONSTRAINT "DentalChartEntry_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 8e: practice profiles, enforced modules, dental chart
-- ============================================================================

-- ---------- Dental chart: FDI numbering, known surfaces, append-only ---------
ALTER TABLE "DentalChartEntry" ADD CONSTRAINT "DentalChartEntry_tooth_chk" CHECK (
  (tooth / 10 BETWEEN 1 AND 4 AND tooth % 10 BETWEEN 1 AND 8)
  OR (tooth / 10 BETWEEN 5 AND 8 AND tooth % 10 BETWEEN 1 AND 5));
ALTER TABLE "DentalChartEntry" ADD CONSTRAINT "DentalChartEntry_surfaces_chk" CHECK (surfaces <@ ARRAY['M','O','D','B','L']::text[]);

CREATE FUNCTION dental_chart_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'Dental chart entries are append-only; record a new entry instead' USING ERRCODE = 'insufficient_privilege';
END $fn$;
CREATE TRIGGER dental_chart_no_change BEFORE UPDATE OR DELETE ON "DentalChartEntry" FOR EACH ROW EXECUTE FUNCTION dental_chart_immutable();

REVOKE ALL ON "DentalChartEntry" FROM PUBLIC;
GRANT SELECT, INSERT ON "DentalChartEntry" TO itopmed_app;
-- Clinical data: nothing for itopmed_platform or itopmed_portal.
ALTER TABLE "DentalChartEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DentalChartEntry" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- ---------- Clinic-side profile and module switches --------------------------
GRANT UPDATE ("practiceType", "setupCompletedAt") ON "Tenant" TO itopmed_app;
-- Owners switch modules on/off (the service limits "on" to what the plan includes).
GRANT INSERT ON "TenantModule" TO itopmed_app;
GRANT UPDATE ("enabled", "updatedAt", "updatedById") ON "TenantModule" TO itopmed_app;

-- The portal checks whether a clinic offers the patient portal before any sign-in.
CREATE FUNCTION portal_module_enabled(p_tenant uuid, p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE((SELECT enabled FROM "TenantModule" WHERE "tenantId" = p_tenant AND "moduleKey" = p_key), false)
$fn$;
REVOKE ALL ON FUNCTION portal_module_enabled(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_module_enabled(uuid, text) TO itopmed_portal;

-- ---------- Data migration: modules become enforced --------------------------
-- Until now module flags were informational and every clinic could use every
-- module. Keep that for existing clinics (no feature disappears on upgrade);
-- new clinics get their plan's modules.
UPDATE "TenantModule" SET enabled = true, "updatedAt" = now() AT TIME ZONE 'UTC'
 WHERE "moduleKey" IN ('patients', 'appointments', 'queue', 'emr', 'laboratory', 'billing', 'inventory', 'hr', 'patient_portal', 'reports');
-- Dentistry is a specialty module, not a tier: every plan includes it, off until a clinic turns it on.
UPDATE "Plan" SET modules = array_append(modules, 'dental'), "updatedAt" = now() AT TIME ZONE 'UTC' WHERE NOT ('dental' = ANY (modules));
INSERT INTO "TenantModule" ("tenantId", "moduleKey", enabled, "updatedAt")
SELECT id, 'dental', false, now() AT TIME ZONE 'UTC' FROM "Tenant"
ON CONFLICT DO NOTHING;
