-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('APPOINTMENT_BOOKED', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'RESULTS_READY');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "subjectId" UUID,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "transport" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "tenantId" UUID NOT NULL,
    "appointmentBooked" BOOLEAN NOT NULL DEFAULT true,
    "appointmentReminder" BOOLEAN NOT NULL DEFAULT true,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "appointmentCancelled" BOOLEAN NOT NULL DEFAULT true,
    "resultsReady" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "Notification_tenantId_status_dueAt_idx" ON "Notification"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_dedupeKey_key" ON "Notification"("tenantId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 8d: notification outbox — integrity & security
-- The outbox holds no message text, addresses or clinical content.
-- ============================================================================
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_attempts_chk" CHECK (attempts BETWEEN 0 AND 10);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_error_chk" CHECK ("lastError" IS NULL OR "lastError" ~ '^[a-z_]{1,40}$');
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_hours_chk" CHECK ("reminderHoursBefore" BETWEEN 1 AND 72);

REVOKE ALL ON "Notification", "NotificationSettings" FROM PUBLIC;
GRANT SELECT, INSERT ON "Notification" TO itopmed_app;
GRANT UPDATE ("status", "attempts", "lastError", "transport", "sentAt", "dueAt", "updatedAt") ON "Notification" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "NotificationSettings" TO itopmed_app;
-- Nothing for itopmed_platform or itopmed_portal.

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "NotificationSettings" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
