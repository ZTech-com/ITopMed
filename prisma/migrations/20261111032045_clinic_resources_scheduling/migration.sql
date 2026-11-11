-- CreateEnum
CREATE TYPE "RoomKind" AS ENUM ('CONSULTATION', 'PROCEDURE', 'LABORATORY', 'IMAGING', 'WARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'IMAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduleExceptionKind" AS ENUM ('DAY_OFF', 'VACATION', 'TRAINING', 'OTHER_ABSENCE');

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RoomKind" NOT NULL DEFAULT 'CONSULTATION',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL DEFAULT 'CONSULTATION',
    "departmentId" UUID,
    "durationMinutes" INTEGER NOT NULL DEFAULT 20,
    "priceMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "specialty" TEXT NOT NULL,
    "departmentId" UUID,
    "licenseNumber" TEXT,
    "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 20,
    "acceptsOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorService" (
    "tenantId" UUID NOT NULL,
    "doctorProfileId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "DoctorService_pkey" PRIMARY KEY ("doctorProfileId","serviceId")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "doctorProfileId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "roomId" UUID,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "doctorProfileId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ScheduleExceptionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Room_tenantId_idx" ON "Room"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_tenantId_branchId_name_key" ON "Room"("tenantId", "branchId", "name");

-- CreateIndex
CREATE INDEX "Service_tenantId_idx" ON "Service"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_tenantId_code_key" ON "Service"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_membershipId_key" ON "DoctorProfile"("membershipId");

-- CreateIndex
CREATE INDEX "DoctorProfile_tenantId_idx" ON "DoctorProfile"("tenantId");

-- CreateIndex
CREATE INDEX "DoctorService_tenantId_idx" ON "DoctorService"("tenantId");

-- CreateIndex
CREATE INDEX "WorkSchedule_tenantId_doctorProfileId_weekday_idx" ON "WorkSchedule"("tenantId", "doctorProfileId", "weekday");

-- CreateIndex
CREATE INDEX "ScheduleException_tenantId_date_idx" ON "ScheduleException"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleException_doctorProfileId_date_key" ON "ScheduleException"("doctorProfileId", "date");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorService" ADD CONSTRAINT "DoctorService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorService" ADD CONSTRAINT "DoctorService_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorService" ADD CONSTRAINT "DoctorService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Data quality -------------------------------------------------------
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_weekday_chk" CHECK (weekday BETWEEN 1 AND 7);
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_minutes_chk" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_slot_chk" CHECK ("defaultSlotMinutes" BETWEEN 5 AND 240);
ALTER TABLE "Service" ADD CONSTRAINT "Service_duration_chk" CHECK ("durationMinutes" BETWEEN 5 AND 480);
ALTER TABLE "Service" ADD CONSTRAINT "Service_price_chk" CHECK ("priceMinor" >= 0);
ALTER TABLE "Service" ADD CONSTRAINT "Service_currency_chk" CHECK (currency IN ('UZS', 'USD'));
ALTER TABLE "Service" ADD CONSTRAINT "Service_code_chk" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$');

-- ---------- Grants: clinic role only (operational data; platform role gets nothing)
REVOKE ALL ON "Room", "Service", "DoctorProfile", "DoctorService", "WorkSchedule", "ScheduleException" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "Room", "Service", "DoctorProfile" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DoctorService", "WorkSchedule", "ScheduleException" TO itopmed_app;

-- ---------- Row-Level Security --------------------------------------------------
ALTER TABLE "Room"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Service"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorProfile"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DoctorService"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkSchedule"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Room"              TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "Service"           TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "DoctorProfile"     TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "DoctorService"     TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "WorkSchedule"      TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "ScheduleException" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- ---------- New permissions for existing clinics' standard roles ---------------
-- Mirrors ROLE_TEMPLATES in src/server/authz/permissions.ts (new clinics get them at provisioning).
INSERT INTO "RolePermission" ("tenantId", "roleId", permission)
SELECT r."tenantId", r.id, v.permission
FROM "Role" r
JOIN (VALUES
  ('clinic_owner', 'schedules.read'), ('clinic_owner', 'schedules.manage'), ('clinic_owner', 'services.read'),
  ('clinic_admin', 'schedules.read'), ('clinic_admin', 'schedules.manage'), ('clinic_admin', 'services.read'),
  ('branch_manager', 'schedules.read'), ('branch_manager', 'schedules.manage'), ('branch_manager', 'services.read'),
  ('receptionist', 'schedules.read'), ('receptionist', 'services.read'),
  ('doctor', 'services.read'),
  ('head_doctor', 'schedules.read'), ('head_doctor', 'services.read'),
  ('nurse', 'schedules.read'),
  ('cashier', 'services.read'),
  ('accountant', 'services.read'),
  ('hr_manager', 'schedules.read'), ('hr_manager', 'schedules.manage')
) AS v(key, permission) ON v.key = r.key AND r."isSystem"
ON CONFLICT DO NOTHING;
