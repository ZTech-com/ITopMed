-- AlterTable
ALTER TABLE "SupportAccessGrant" ADD COLUMN     "requesterEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requesterName" TEXT NOT NULL DEFAULT '';
