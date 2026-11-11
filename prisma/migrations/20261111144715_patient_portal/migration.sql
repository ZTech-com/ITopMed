-- CreateEnum
CREATE TYPE "PortalAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- AlterEnum
ALTER TYPE "AuditActorType" ADD VALUE 'PATIENT';

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedById" UUID;

-- CreateTable
CREATE TABLE "PatientAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "login" TEXT,
    "passwordHash" TEXT,
    "status" "PortalAccountStatus" NOT NULL DEFAULT 'INVITED',
    "activationCodeHash" TEXT,
    "activationExpiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "locale" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientSession" (
    "id" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_patientId_key" ON "PatientAccount"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_activationCodeHash_key" ON "PatientAccount"("activationCodeHash");

-- CreateIndex
CREATE INDEX "PatientAccount_tenantId_idx" ON "PatientAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_tenantId_login_key" ON "PatientAccount"("tenantId", "login");

-- CreateIndex
CREATE INDEX "PatientSession_accountId_idx" ON "PatientSession"("accountId");

-- CreateIndex
CREATE INDEX "PatientSession_tenantId_idx" ON "PatientSession"("tenantId");

-- AddForeignKey
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Phase 8b: patient portal
--   * third runtime role itopmed_portal (created by infrastructure, like the
--     other two): patients only ever see THEIR OWN, RELEASED data
--   * the patient identity is derived inside PostgreSQL from the presented
--     session hash (app.session_id); application code cannot widen it
--   * no grants at all on clinical notes, diagnoses, allergies, vitals,
--     encounters, staff accounts or audit reads
-- ============================================================================

-- ---------- Data quality ----------------------------------------------------
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_login_chk" CHECK (login IS NULL OR login ~ '^\+[0-9]{9,15}$');
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_locale_chk" CHECK (locale IS NULL OR locale IN ('uz-Latn','uz-Cyrl','ru','en'));
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_active_chk" CHECK (status <> 'ACTIVE' OR (login IS NOT NULL AND "passwordHash" IS NOT NULL));
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_release_chk" CHECK ("releasedAt" IS NULL OR (status = 'VERIFIED' AND "releasedById" IS NOT NULL));

-- Verified orders stay frozen; the only permitted change is the one-way release to the portal.
CREATE OR REPLACE FUNCTION lab_order_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lab orders cannot be deleted; cancel them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('VERIFIED', 'CANCELLED') THEN
    IF OLD.status = 'VERIFIED' AND OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL
       AND (to_jsonb(NEW) - 'releasedAt' - 'releasedById') = (to_jsonb(OLD) - 'releasedAt' - 'releasedById') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Verified or cancelled lab orders are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $fn$;

-- ---------- Portal identity (derived from the session, never trusted from the app)
CREATE FUNCTION portal_current_account() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a.id FROM "PatientSession" s
    JOIN "PatientAccount" a ON a.id = s."accountId" AND a."tenantId" = s."tenantId"
   WHERE s.id = app_current_session()
     AND s."revokedAt" IS NULL
     AND s."expiresAt" > (now() AT TIME ZONE 'UTC')
     AND s."lastSeenAt" > (now() AT TIME ZONE 'UTC') - interval '30 minutes'
     AND a.status = 'ACTIVE'
$fn$;
CREATE FUNCTION portal_current_patient() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a."patientId" FROM "PatientAccount" a WHERE a.id = portal_current_account()
$fn$;
CREATE FUNCTION portal_current_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a."tenantId" FROM "PatientAccount" a WHERE a.id = portal_current_account()
$fn$;

-- Login lookup and lockout counter (no session exists yet).
CREATE FUNCTION portal_auth_lookup(p_tenant uuid, p_login text)
RETURNS TABLE (id uuid, "passwordHash" text, status "PortalAccountStatus", "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a.id, a."passwordHash", a.status, a."lockedUntil" FROM "PatientAccount" a
   WHERE a."tenantId" = p_tenant AND a.login = p_login
$fn$;
CREATE FUNCTION portal_auth_record_failure(p_account uuid, p_max int, p_lock_minutes int)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE "PatientAccount" SET
    "failedLoginCount" = "failedLoginCount" + 1,
    "lockedUntil" = CASE WHEN "failedLoginCount" + 1 >= p_max
                         THEN (now() AT TIME ZONE 'UTC') + make_interval(mins => p_lock_minutes)
                         ELSE "lockedUntil" END,
    -- Too many wrong answers during activation burn the code.
    "activationCodeHash" = CASE WHEN status = 'INVITED' AND "failedLoginCount" + 1 >= p_max THEN NULL ELSE "activationCodeHash" END,
    "updatedAt" = now() AT TIME ZONE 'UTC'
  WHERE id = p_account
$fn$;
-- Activation: the account matching the presented code hash, with the patient's birth date for the second check.
CREATE FUNCTION portal_activation_lookup(p_code_hash text)
RETURNS TABLE (id uuid, "tenantId" uuid, "birthDate" date, status "PortalAccountStatus", "activationExpiresAt" timestamp(3), "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a.id, a."tenantId", p."birthDate", a.status, a."activationExpiresAt", a."lockedUntil"
    FROM "PatientAccount" a JOIN "Patient" p ON p.id = a."patientId" AND p."tenantId" = a."tenantId"
   WHERE a."activationCodeHash" = p_code_hash
$fn$;
-- Activation in one atomic step: code, expiry, lock and birth date are re-checked here,
-- so the account row never has to be visible to the (not yet signed-in) caller.
CREATE FUNCTION portal_activate(p_code_hash text, p_birth_date date, p_login text, p_password_hash text)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE "PatientAccount" a SET
    login = p_login, "passwordHash" = p_password_hash, status = 'ACTIVE',
    "activationCodeHash" = NULL, "activationExpiresAt" = NULL, "activatedAt" = now() AT TIME ZONE 'UTC',
    "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = now() AT TIME ZONE 'UTC'
  WHERE a."activationCodeHash" = p_code_hash AND a.status = 'INVITED'
    AND a."activationExpiresAt" > now() AT TIME ZONE 'UTC'
    AND (a."lockedUntil" IS NULL OR a."lockedUntil" <= now() AT TIME ZONE 'UTC')
    AND EXISTS (SELECT 1 FROM "Patient" p WHERE p.id = a."patientId" AND p."tenantId" = a."tenantId" AND p."birthDate" = p_birth_date)
  RETURNING a.id
$fn$;
-- Doctor display names for the patient's own appointments/results (current clinic only).
CREATE FUNCTION portal_doctor_names(p_ids uuid[])
RETURNS TABLE (id uuid, "fullName" text, specialty text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT d.id, u."fullName", d.specialty FROM "DoctorProfile" d
    JOIN "Membership" m ON m.id = d."membershipId" AND m."tenantId" = d."tenantId"
    JOIN "User" u ON u.id = m."userId"
   WHERE d.id = ANY(p_ids) AND d."tenantId" = portal_current_tenant()
$fn$;

REVOKE ALL ON FUNCTION portal_current_account(), portal_current_patient(), portal_current_tenant(),
  portal_auth_lookup(uuid, text), portal_auth_record_failure(uuid, int, int),
  portal_activation_lookup(text), portal_activate(text, date, text, text), portal_doctor_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_current_account(), portal_current_patient(), portal_current_tenant(),
  portal_auth_lookup(uuid, text), portal_auth_record_failure(uuid, int, int),
  portal_activation_lookup(text), portal_activate(text, date, text, text), portal_doctor_names(uuid[]) TO itopmed_portal;

-- ---------- Grants: portal role (deny by default; columns listed explicitly) ---
REVOKE ALL ON "PatientAccount", "PatientSession" FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO itopmed_portal;
GRANT USAGE ON SEQUENCE "AuditEvent_seq_seq" TO itopmed_portal;
GRANT INSERT ON "AuditEvent" TO itopmed_portal;
GRANT SELECT ("id", "slug", "name", "status", "defaultLocale", "timezone", "currency") ON "Tenant" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "name", "address", "phone") ON "Branch" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "name", "kind") ON "Service" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "specialty") ON "DoctorProfile" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "mrn", "lastName", "firstName", "middleName", "birthDate", "sex", "phone", "email", "preferredLocale") ON "Patient" TO itopmed_portal;
GRANT SELECT ON "PatientAccount" TO itopmed_portal;
GRANT UPDATE ("login", "passwordHash", "status", "activationCodeHash", "activationExpiresAt", "activatedAt", "failedLoginCount", "lockedUntil", "lastLoginAt", "locale", "updatedAt") ON "PatientAccount" TO itopmed_portal;
GRANT SELECT, INSERT ON "PatientSession" TO itopmed_portal;
GRANT UPDATE ("lastSeenAt", "revokedAt") ON "PatientSession" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "patientId", "doctorProfileId", "branchId", "serviceId", "startsAt", "endsAt", "status", "cancelledAt", "cancellationReason") ON "Appointment" TO itopmed_portal;
GRANT UPDATE ("status", "cancelledAt", "cancellationReason", "updatedAt") ON "Appointment" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "number", "patientId", "branchId", "status", "currency", "subtotalMinor", "discountMinor", "totalMinor", "paidMinor", "issuedAt", "voidedAt") ON "Invoice" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "invoiceId", "description", "quantity", "unitPriceMinor", "discountMinor", "totalMinor") ON "InvoiceLine" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "invoiceId", "amountMinor", "currency", "method", "refundedMinor", "receivedAt") ON "Payment" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "number", "patientId", "doctorProfileId", "branchId", "status", "priority", "orderedAt", "verifiedAt", "releasedAt") ON "LabOrder" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "orderId", "name") ON "LabOrderItem" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "orderItemId", "analyteId", "value", "unit", "refLow", "refHigh", "flag") ON "LabResult" TO itopmed_portal;
GRANT SELECT ("id", "tenantId", "name", "loinc", "sortOrder") ON "LabAnalyte" TO itopmed_portal;
GRANT SELECT, INSERT ON "PatientConsent" TO itopmed_portal;
GRANT UPDATE ("withdrawnAt") ON "PatientConsent" TO itopmed_portal;

-- ---------- Grants: clinic role (front desk manages accounts; never reads password hashes)
GRANT SELECT ("id", "tenantId", "patientId", "login", "status", "activationExpiresAt", "activatedAt", "failedLoginCount", "lockedUntil", "lastLoginAt", "locale", "createdById", "createdAt", "updatedAt") ON "PatientAccount" TO itopmed_app;
GRANT INSERT ON "PatientAccount" TO itopmed_app;
GRANT UPDATE ("login", "passwordHash", "status", "activationCodeHash", "activationExpiresAt", "failedLoginCount", "lockedUntil", "updatedAt") ON "PatientAccount" TO itopmed_app;
GRANT SELECT ("id", "tenantId", "accountId", "expiresAt", "revokedAt") ON "PatientSession" TO itopmed_app;
GRANT UPDATE ("revokedAt") ON "PatientSession" TO itopmed_app;
-- Nothing for itopmed_platform.

-- ---------- Row-Level Security ---------------------------------------------------
ALTER TABLE "PatientAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientAccount" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "PatientSession" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

-- Portal: the signed-in patient's own account only (activation goes through portal_activate).
-- Updatable columns exclude tenantId/patientId, so the check only keeps the row in a valid state.
CREATE POLICY portal_own ON "PatientAccount" FOR SELECT TO itopmed_portal
  USING (id = (SELECT portal_current_account()));
CREATE POLICY portal_update ON "PatientAccount" FOR UPDATE TO itopmed_portal
  USING (id = (SELECT portal_current_account()))
  WITH CHECK (status IN ('ACTIVE', 'DISABLED'));
CREATE POLICY portal_own ON "PatientSession" TO itopmed_portal
  USING (id = app_current_session() OR "accountId" = (SELECT portal_current_account()))
  WITH CHECK (id = app_current_session() OR "accountId" = (SELECT portal_current_account()));

CREATE POLICY portal_read ON "Tenant" FOR SELECT TO itopmed_portal USING (status IN ('TRIAL', 'ACTIVE'));
CREATE POLICY portal_read ON "Branch" FOR SELECT TO itopmed_portal USING ("tenantId" = (SELECT portal_current_tenant()));
CREATE POLICY portal_read ON "Service" FOR SELECT TO itopmed_portal USING ("tenantId" = (SELECT portal_current_tenant()));
CREATE POLICY portal_read ON "DoctorProfile" FOR SELECT TO itopmed_portal USING ("tenantId" = (SELECT portal_current_tenant()));
CREATE POLICY portal_read ON "LabAnalyte" FOR SELECT TO itopmed_portal USING ("tenantId" = (SELECT portal_current_tenant()));
CREATE POLICY portal_own ON "Patient" FOR SELECT TO itopmed_portal USING (id = (SELECT portal_current_patient()));

CREATE POLICY portal_own ON "Appointment" FOR SELECT TO itopmed_portal USING ("patientId" = (SELECT portal_current_patient()));
-- Patients may cancel their own booked appointment up to 2 hours before it starts (enforced here, not only in code).
CREATE POLICY portal_cancel ON "Appointment" FOR UPDATE TO itopmed_portal
  USING ("patientId" = (SELECT portal_current_patient()) AND status = 'BOOKED' AND "startsAt" > (now() AT TIME ZONE 'UTC') + interval '2 hours')
  WITH CHECK ("patientId" = (SELECT portal_current_patient()) AND status = 'CANCELLED' AND "cancellationReason" = 'PATIENT_REQUEST');

CREATE POLICY portal_own ON "Invoice" FOR SELECT TO itopmed_portal
  USING ("patientId" = (SELECT portal_current_patient()) AND status <> 'DRAFT');
CREATE POLICY portal_own ON "InvoiceLine" FOR SELECT TO itopmed_portal
  USING ("tenantId" = (SELECT portal_current_tenant()) AND EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"));
CREATE POLICY portal_own ON "Payment" FOR SELECT TO itopmed_portal
  USING ("tenantId" = (SELECT portal_current_tenant()) AND EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = "invoiceId"));

-- Lab results reach the patient only when verified AND released by the doctor.
CREATE POLICY portal_own ON "LabOrder" FOR SELECT TO itopmed_portal
  USING ("patientId" = (SELECT portal_current_patient()) AND status = 'VERIFIED' AND "releasedAt" IS NOT NULL);
CREATE POLICY portal_own ON "LabOrderItem" FOR SELECT TO itopmed_portal
  USING ("tenantId" = (SELECT portal_current_tenant()) AND EXISTS (SELECT 1 FROM "LabOrder" o WHERE o.id = "orderId"));
CREATE POLICY portal_own ON "LabResult" FOR SELECT TO itopmed_portal
  USING ("tenantId" = (SELECT portal_current_tenant()) AND EXISTS (SELECT 1 FROM "LabOrderItem" i WHERE i.id = "orderItemId"));

CREATE POLICY portal_own ON "PatientConsent" FOR SELECT TO itopmed_portal USING ("patientId" = (SELECT portal_current_patient()));
CREATE POLICY portal_grant ON "PatientConsent" FOR INSERT TO itopmed_portal
  WITH CHECK ("patientId" = (SELECT portal_current_patient()) AND "tenantId" = (SELECT portal_current_tenant())
              AND method = 'PORTAL' AND "withdrawnAt" IS NULL AND purpose <> 'PATIENT_PORTAL');
CREATE POLICY portal_withdraw ON "PatientConsent" FOR UPDATE TO itopmed_portal
  USING ("patientId" = (SELECT portal_current_patient()) AND "withdrawnAt" IS NULL AND purpose <> 'PATIENT_PORTAL')
  WITH CHECK ("patientId" = (SELECT portal_current_patient()) AND "withdrawnAt" IS NOT NULL);

-- Audit: the portal may only append patient/anonymous events to a clinic chain.
CREATE POLICY portal_insert ON "AuditEvent" FOR INSERT TO itopmed_portal
  WITH CHECK ("tenantId" IS NOT NULL AND "actorType"::text IN ('PATIENT', 'ANONYMOUS'));

-- ---------- New permission for existing clinics' standard roles ---------------
-- portal.manage: issue/reissue portal activation codes and disable portal access.
INSERT INTO "RolePermission" ("tenantId", "roleId", permission)
SELECT r."tenantId", r.id, v.permission
FROM "Role" r
JOIN (VALUES ('receptionist', 'portal.manage'), ('clinic_admin', 'portal.manage')) AS v(key, permission)
  ON v.key = r.key AND r."isSystem"
ON CONFLICT DO NOTHING;
