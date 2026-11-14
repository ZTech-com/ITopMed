-- AlterEnum
ALTER TYPE "DiagnosisKind" ADD VALUE 'COMPLICATION';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "birthYearOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "licenseText" TEXT,
ADD COLUMN     "logoDataUrl" TEXT;


-- Letterhead: the clinic owner/admin edits it (column grants, like the other Tenant settings).
GRANT UPDATE ("logoDataUrl", "licenseText", "updatedAt") ON "Tenant" TO itopmed_app;
-- A logo is a small image kept inline (about 300 KB at most), never a file path.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_logo_chk"
  CHECK ("logoDataUrl" IS NULL OR ("logoDataUrl" ~ '^data:image/(png|jpeg|webp);base64,' AND length("logoDataUrl") <= 420000));
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_license_chk" CHECK ("licenseText" IS NULL OR length("licenseText") <= 300);
-- The patient portal keeps its column-level grants on "Tenant" and "Patient" (not extended here).
