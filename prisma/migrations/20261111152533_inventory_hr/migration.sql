-- CreateEnum
CREATE TYPE "InventoryCategory" AS ENUM ('MEDICINE', 'CONSUMABLE', 'REAGENT', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIPT', 'ISSUE', 'DISPENSE', 'ADJUSTMENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('COUNT_CORRECTION', 'EXPIRED', 'DAMAGED', 'LOST', 'RECALLED', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('MEDICAL_LICENSE', 'SPECIALIST_CERTIFICATE', 'QUALIFICATION_CATEGORY', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveKind" AS ENUM ('VACATION', 'SICK_LEAVE', 'TRAINING', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ScheduleException" ADD COLUMN     "leaveId" UUID;

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "InventoryCategory" NOT NULL DEFAULT 'MEDICINE',
    "form" TEXT,
    "strength" TEXT,
    "unit" TEXT NOT NULL,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "barcode" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "phone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBatch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID,
    "lotNumber" TEXT NOT NULL,
    "expiresOn" DATE,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "StockReason",
    "patientId" UUID,
    "departmentId" UUID,
    "documentRef" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "personnelNumber" TEXT,
    "position" TEXT,
    "departmentId" UUID,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "hiredOn" DATE,
    "workPhone" TEXT,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCredential" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "title" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLeave" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "kind" "LeaveKind" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'APPROVED',
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_tenantId_name_idx" ON "InventoryItem"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_tenantId_code_key" ON "InventoryItem"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_name_key" ON "Supplier"("tenantId", "name");

-- CreateIndex
CREATE INDEX "StockBatch_tenantId_branchId_itemId_idx" ON "StockBatch"("tenantId", "branchId", "itemId");

-- CreateIndex
CREATE INDEX "StockBatch_tenantId_expiresOn_idx" ON "StockBatch"("tenantId", "expiresOn");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_itemId_createdAt_idx" ON "StockMovement"("tenantId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_patientId_idx" ON "StockMovement"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_membershipId_key" ON "StaffProfile"("membershipId");

-- CreateIndex
CREATE INDEX "StaffProfile_tenantId_idx" ON "StaffProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_tenantId_personnelNumber_key" ON "StaffProfile"("tenantId", "personnelNumber");

-- CreateIndex
CREATE INDEX "StaffCredential_tenantId_expiresOn_idx" ON "StaffCredential"("tenantId", "expiresOn");

-- CreateIndex
CREATE INDEX "StaffCredential_tenantId_membershipId_idx" ON "StaffCredential"("tenantId", "membershipId");

-- CreateIndex
CREATE INDEX "StaffLeave_tenantId_startsOn_idx" ON "StaffLeave"("tenantId", "startsOn");

-- CreateIndex
CREATE INDEX "StaffLeave_tenantId_membershipId_idx" ON "StaffLeave"("tenantId", "membershipId");

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "StaffLeave"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 8c: pharmacy/inventory and HR — integrity & security
-- ============================================================================

-- ---------- Data quality ----------------------------------------------------
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_minStock_chk" CHECK ("minStock" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_code_chk" CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_quantity_chk" CHECK (quantity >= 0);
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_cost_chk" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sign_chk" CHECK (
  (kind = 'RECEIPT' AND quantity > 0)
  OR (kind IN ('ISSUE', 'DISPENSE', 'WRITE_OFF') AND quantity < 0)
  OR (kind = 'ADJUSTMENT' AND quantity <> 0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_patient_chk" CHECK ((kind = 'DISPENSE') = ("patientId" IS NOT NULL));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reason_chk" CHECK (kind NOT IN ('WRITE_OFF', 'ADJUSTMENT') OR reason IS NOT NULL);
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_range_chk" CHECK ("endsOn" >= "startsOn" AND "endsOn" - "startsOn" <= 365);
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_dates_chk" CHECK ("issuedOn" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "issuedOn");

-- ---------- Stock is a ledger ----------------------------------------------------
-- A new batch always starts empty; stock arrives through a RECEIPT movement.
CREATE FUNCTION stock_batch_new() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.quantity := 0;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_batch_new BEFORE INSERT ON "StockBatch" FOR EACH ROW EXECUTE FUNCTION stock_batch_new();

-- Every movement updates its batch atomically (row lock). The batch CHECK makes
-- negative stock impossible; expired batches cannot be issued or dispensed.
CREATE FUNCTION stock_movement_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE b "StockBatch";
BEGIN
  SELECT * INTO b FROM "StockBatch" WHERE id = NEW."batchId" FOR UPDATE;
  IF b.id IS NULL OR b."tenantId" <> NEW."tenantId" OR b."itemId" <> NEW."itemId" OR b."branchId" <> NEW."branchId" THEN
    RAISE EXCEPTION 'Stock movement does not match its batch' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind IN ('ISSUE', 'DISPENSE') AND b."expiresOn" IS NOT NULL AND b."expiresOn" < (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Expired stock cannot be issued' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE "StockBatch" SET quantity = quantity + NEW.quantity WHERE id = b.id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER stock_movement_apply BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION stock_movement_apply();
REVOKE ALL ON FUNCTION stock_movement_apply() FROM PUBLIC;

CREATE FUNCTION stock_movement_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'StockMovement is append-only; record a correcting movement' USING ERRCODE = 'insufficient_privilege';
END $fn$;
CREATE TRIGGER stock_movement_no_change BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION stock_movement_immutable();

-- ---------- Grants: clinic role only (dispensing links patients; nothing for the platform role)
REVOKE ALL ON "InventoryItem", "Supplier", "StockBatch", "StockMovement", "StaffProfile", "StaffCredential", "StaffLeave" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "InventoryItem", "Supplier" TO itopmed_app;
-- No UPDATE on batches: quantities change only through the ledger trigger.
GRANT SELECT, INSERT ON "StockBatch" TO itopmed_app;
GRANT SELECT, INSERT ON "StockMovement" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "StaffProfile" TO itopmed_app;
GRANT SELECT, INSERT ON "StaffCredential" TO itopmed_app;
GRANT UPDATE ("archivedAt") ON "StaffCredential" TO itopmed_app;
GRANT SELECT, INSERT ON "StaffLeave" TO itopmed_app;
GRANT UPDATE ("status", "cancelledAt") ON "StaffLeave" TO itopmed_app;

DO $fn$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['InventoryItem','Supplier','StockBatch','StockMovement','StaffProfile','StaffCredential','StaffLeave']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $fn$;
