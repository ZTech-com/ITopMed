
-- AlterEnum
ALTER TYPE "PlatformRole" ADD VALUE 'NETWORK_ADMIN';

-- AlterTable
ALTER TABLE "PlatformInvitation" ADD COLUMN     "networkId" UUID;

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN     "networkId" UUID;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "networkId" UUID,
ADD COLUMN     "setupPreset" JSONB;

-- CreateTable
CREATE TABLE "Network" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvitation" ADD CONSTRAINT "PlatformInvitation_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Indexes
CREATE INDEX "Tenant_networkId_idx" ON "Tenant"("networkId");
CREATE INDEX "PlatformUser_networkId_idx" ON "PlatformUser"("networkId");

-- A network admin always belongs to exactly one network; other platform roles never do.
-- (role::text: a new enum value cannot be referenced in the transaction that adds it.)
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_network_role_chk"
  CHECK (("role"::text = 'NETWORK_ADMIN') = ("networkId" IS NOT NULL));
ALTER TABLE "PlatformInvitation" ADD CONSTRAINT "PlatformInvitation_network_role_chk"
  CHECK (("role"::text = 'NETWORK_ADMIN') = ("networkId" IS NOT NULL));

-- Network is a platform-only table (clinics never read it).
GRANT SELECT, INSERT, UPDATE ON "Network" TO itopmed_platform;
ALTER TABLE "Network" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON "Network" TO itopmed_platform USING (true) WITH CHECK (true);

-- The patient portal must not learn which network a clinic belongs to or its setup preset:
-- portal grants on "Tenant" are column-level and are intentionally NOT extended here.
