-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'RESULTED', 'VERIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabPriority" AS ENUM ('ROUTINE', 'URGENT');

-- CreateEnum
CREATE TYPE "LabFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH');

-- CreateTable
CREATE TABLE "LabAnalyte" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "loinc" TEXT,
    "unit" TEXT NOT NULL,
    "refLow" DECIMAL(12,4),
    "refHigh" DECIMAL(12,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAnalyte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "doctorProfileId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "priority" "LabPriority" NOT NULL DEFAULT 'ROUTINE',
    "indication" TEXT,
    "orderedById" UUID NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedAt" TIMESTAMP(3),
    "collectedById" UUID,
    "resultedAt" TIMESTAMP(3),
    "resultedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrderItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "LabOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "analyteId" UUID NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "refLow" DECIMAL(12,4),
    "refHigh" DECIMAL(12,4),
    "flag" "LabFlag" NOT NULL,
    "enteredById" UUID NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabAnalyte_tenantId_serviceId_idx" ON "LabAnalyte"("tenantId", "serviceId");

-- CreateIndex
CREATE INDEX "LabOrder_tenantId_status_orderedAt_idx" ON "LabOrder"("tenantId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "LabOrder_tenantId_patientId_idx" ON "LabOrder"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_tenantId_number_key" ON "LabOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "LabOrderItem_tenantId_orderId_idx" ON "LabOrderItem"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "LabResult_tenantId_idx" ON "LabResult"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_orderItemId_analyteId_key" ON "LabResult"("orderItemId", "analyteId");

-- AddForeignKey
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "LabOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_analyteId_fkey" FOREIGN KEY ("analyteId") REFERENCES "LabAnalyte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 8a: laboratory integrity & security
-- ============================================================================
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_number_chk" CHECK (number ~ '^LAB-[0-9]{4}-[0-9]{6,}$');
-- Four-eyes principle: results are verified by someone other than who entered them.
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_four_eyes_chk" CHECK ("verifiedById" IS NULL OR "verifiedById" <> "resultedById");
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_range_chk" CHECK ("refLow" IS NULL OR "refHigh" IS NULL OR "refLow" <= "refHigh");

-- Results are frozen once the order is verified or cancelled.
CREATE FUNCTION lab_result_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st "LabOrderStatus";
BEGIN
  SELECT o.status INTO st FROM "LabOrder" o JOIN "LabOrderItem" i ON i."orderId" = o.id
   WHERE i.id = COALESCE(NEW."orderItemId", OLD."orderItemId");
  IF st IN ('VERIFIED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Lab results are final once the order is verified' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
CREATE TRIGGER lab_result_guard BEFORE INSERT OR UPDATE OR DELETE ON "LabResult"
  FOR EACH ROW EXECUTE FUNCTION lab_result_guard();

CREATE FUNCTION lab_order_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lab orders cannot be deleted; cancel them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('VERIFIED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Verified or cancelled lab orders are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER lab_order_guard BEFORE UPDATE OR DELETE ON "LabOrder"
  FOR EACH ROW EXECUTE FUNCTION lab_order_guard();

-- ---------- Grants: clinic role only (clinical data; nothing for the platform role)
REVOKE ALL ON "LabAnalyte", "LabOrder", "LabOrderItem", "LabResult" FROM PUBLIC;
GRANT SELECT, INSERT ON "LabAnalyte" TO itopmed_app;
GRANT UPDATE ("name", "loinc", "unit", "refLow", "refHigh", "sortOrder", "archivedAt") ON "LabAnalyte" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "LabOrder" TO itopmed_app;
GRANT SELECT, INSERT ON "LabOrderItem" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "LabResult" TO itopmed_app;

DO $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LabAnalyte','LabOrder','LabOrderItem','LabResult']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $fn$;

-- ---------- New permissions for existing clinics' standard roles ---------------
-- lab.collect: take specimens (nurses, lab staff). lab.manage: test analytes and reference ranges.
INSERT INTO "RolePermission" ("tenantId", "roleId", permission)
SELECT r."tenantId", r.id, v.permission
FROM "Role" r
JOIN (VALUES ('nurse', 'lab.collect'), ('lab_staff', 'lab.collect'), ('lab_staff', 'lab.manage'), ('clinic_admin', 'lab.manage')) AS v(key, permission)
  ON v.key = r.key AND r."isSystem"
ON CONFLICT DO NOTHING;
