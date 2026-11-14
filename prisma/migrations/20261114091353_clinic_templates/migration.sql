-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('NOTE', 'DOCUMENT');

-- CreateTable
CREATE TABLE "ClinicTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "content" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ClinicTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicTemplate_tenantId_kind_idx" ON "ClinicTemplate"("tenantId", "kind");

-- AddForeignKey
ALTER TABLE "ClinicTemplate" ADD CONSTRAINT "ClinicTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Clinic templates - security
-- Generic text the clinic writes itself (no patient data). Clinic role only;
-- platform staff get no grant.
-- ============================================================================
ALTER TABLE "ClinicTemplate" ADD CONSTRAINT "ClinicTemplate_text_chk" CHECK (
  char_length("name") BETWEEN 2 AND 120 AND char_length("content") BETWEEN 1 AND 20000
  AND ("specialty" IS NULL OR "specialty" ~ '^[a-z_]{2,40}$'));
REVOKE ALL ON "ClinicTemplate" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "ClinicTemplate" TO itopmed_app;
ALTER TABLE "ClinicTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClinicTemplate" TO itopmed_app
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
