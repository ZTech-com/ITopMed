-- Front desk rules: referral source, benefit categories, service packages,
-- free follow-up visits, cashier approval of debt.
CREATE TYPE "ReferralSource" AS ENUM ('SELF', 'DOCTOR', 'ADVERTISING', 'OTHER');
CREATE TYPE "DiscountKind" AS ENUM ('MANUAL', 'BENEFIT', 'PACKAGE', 'FOLLOW_UP', 'FOLLOW_UP_EXCEPTION');

ALTER TABLE "Patient"
  ADD COLUMN "referralSource" "ReferralSource",
  ADD COLUMN "referralDetail" TEXT,
  ADD COLUMN "benefitCategoryId" UUID;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_referralDetail_chk" CHECK ("referralDetail" IS NULL OR length("referralDetail") <= 120);

ALTER TABLE "InvoiceLine"
  ADD COLUMN "discountKind" "DiscountKind",
  ADD COLUMN "discountApprovedById" UUID;
ALTER TABLE "Invoice"
  ADD COLUMN "debtApprovedById" UUID,
  ADD COLUMN "debtApprovedAt" TIMESTAMP(3);
ALTER TABLE "ClinicPolicy" ADD COLUMN "freeFollowUpDays" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "ClinicPolicy" ADD CONSTRAINT "ClinicPolicy_followup_chk" CHECK ("freeFollowUpDays" BETWEEN 0 AND 90);

CREATE TABLE "BenefitCategory" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BenefitCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BenefitCategory_percent_chk" CHECK ("discountPercent" BETWEEN 1 AND 100),
  CONSTRAINT "BenefitCategory_name_chk" CHECK (length("name") BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "BenefitCategory_tenantId_name_key" ON "BenefitCategory"("tenantId", "name");
ALTER TABLE "BenefitCategory" ADD CONSTRAINT "BenefitCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_benefitCategoryId_fkey" FOREIGN KEY ("benefitCategoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ServicePackage" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServicePackage_percent_chk" CHECK ("discountPercent" BETWEEN 0 AND 100),
  CONSTRAINT "ServicePackage_name_chk" CHECK (length("name") BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "ServicePackage_tenantId_name_key" ON "ServicePackage"("tenantId", "name");
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ServicePackageItem" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "packageId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  CONSTRAINT "ServicePackageItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServicePackageItem_packageId_serviceId_key" ON "ServicePackageItem"("packageId", "serviceId");
CREATE INDEX "ServicePackageItem_tenantId_idx" ON "ServicePackageItem"("tenantId");
ALTER TABLE "ServicePackageItem" ADD CONSTRAINT "ServicePackageItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServicePackageItem" ADD CONSTRAINT "ServicePackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicePackageItem" ADD CONSTRAINT "ServicePackageItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants and row-level security (clinic role only; platform staff never see them).
REVOKE ALL ON "BenefitCategory", "ServicePackage", "ServicePackageItem" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "BenefitCategory", "ServicePackage" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ServicePackageItem" TO itopmed_app;
ALTER TABLE "BenefitCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePackageItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BenefitCategory" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "ServicePackage" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "ServicePackageItem" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- New permissions for existing clinics' system roles.
--  billing.free_visit: allow a free follow-up outside the free period (reason + who, audited).
--  documents.print:   the desk prints finished visit documents once the cashier has settled the bill.
INSERT INTO "RolePermission" ("tenantId", "roleId", permission)
SELECT r."tenantId", r.id, v.permission
FROM "Role" r
JOIN (VALUES ('clinic_owner', 'billing.free_visit'), ('clinic_admin', 'billing.free_visit'), ('cashier', 'billing.free_visit'),
             ('receptionist', 'documents.print'), ('clinic_admin', 'documents.print')) AS v(key, permission)
  ON v.key = r.key AND r."isSystem"
ON CONFLICT DO NOTHING;
