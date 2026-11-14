-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'TELEGRAM';

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ClinicPolicy" ADD COLUMN     "onlineBookingDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "onlineBookingLeadMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "onlineBookingMaxActive" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "TelegramBot" (
    "tenantId" UUID NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updateOffset" BIGINT NOT NULL DEFAULT 0,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramBot_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "chatId" BIGINT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "codeHash" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("codeHash")
);

-- CreateIndex
CREATE INDEX "TelegramLink_tenantId_patientId_idx" ON "TelegramLink"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_tenantId_idx" ON "TelegramLinkCode"("tenantId");

-- AddForeignKey
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Patient portal self-booking and Telegram notifications - security
-- ============================================================================
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_creator_chk" CHECK ("createdById" IS NOT NULL OR source = 'PORTAL');
ALTER TABLE "ClinicPolicy" ADD CONSTRAINT "ClinicPolicy_booking_chk" CHECK (
  "onlineBookingDays" BETWEEN 1 AND 180 AND "onlineBookingLeadMinutes" BETWEEN 0 AND 10080 AND "onlineBookingMaxActive" BETWEEN 1 AND 20);

-- ---------- Telegram: the bot token is a secret of the clinic only ------------
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_hash_chk" CHECK ("codeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "TelegramBot" ADD CONSTRAINT "TelegramBot_username_chk" CHECK ("username" ~ '^[A-Za-z0-9_]{5,64}$');
REVOKE ALL ON "TelegramBot", "TelegramLink", "TelegramLinkCode" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TelegramBot" TO itopmed_app;
GRANT SELECT, INSERT, UPDATE ON "TelegramLink" TO itopmed_app;
GRANT SELECT, UPDATE ("usedAt"), DELETE ON "TelegramLinkCode" TO itopmed_app;
-- Patients see whether their own link is active (not the chat id) and can disconnect it; they create their own link codes.
GRANT SELECT ("id", "tenantId", "patientId", "linkedAt", "revokedAt") ON "TelegramLink" TO itopmed_portal;
GRANT UPDATE ("revokedAt") ON "TelegramLink" TO itopmed_portal;
GRANT INSERT ON "TelegramLinkCode" TO itopmed_portal;
-- Platform staff get nothing: no tokens, no patient chats.
ALTER TABLE "TelegramBot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelegramLinkCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TelegramBot" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "TelegramLink" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY tenant_isolation ON "TelegramLinkCode" TO itopmed_app USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY portal_own ON "TelegramLink" FOR SELECT TO itopmed_portal USING ("patientId" = (SELECT portal_current_patient()));
CREATE POLICY portal_revoke ON "TelegramLink" FOR UPDATE TO itopmed_portal
  USING ("patientId" = (SELECT portal_current_patient())) WITH CHECK ("patientId" = (SELECT portal_current_patient()) AND "revokedAt" IS NOT NULL);
CREATE POLICY portal_insert ON "TelegramLinkCode" FOR INSERT TO itopmed_portal
  WITH CHECK ("patientId" = (SELECT portal_current_patient()) AND "tenantId" = (SELECT portal_current_tenant()));

-- The bot's public @username, for the patient's connect link (never the token).
CREATE FUNCTION portal_telegram_bot() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT b.username FROM "TelegramBot" b WHERE b."tenantId" = portal_current_tenant() AND b.enabled
$fn$;

-- ---------- Self-booking ------------------------------------------------------
-- The portal role cannot read other patients' appointments, so availability is
-- exposed through these functions, which return times only (no identities), and
-- the booking itself is validated and written by portal_book() inside PostgreSQL.

CREATE FUNCTION portal_bookable_doctor(p_doctor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM "DoctorProfile" d
      JOIN "Membership" m ON m.id = d."membershipId" AND m.status = 'ACTIVE'
      JOIN "Tenant" t ON t.id = d."tenantId" AND t.status IN ('TRIAL', 'ACTIVE')
      JOIN "TenantModule" tm ON tm."tenantId" = d."tenantId" AND tm."moduleKey" = 'patient_portal' AND tm.enabled
     WHERE d.id = p_doctor AND d."tenantId" = portal_current_tenant() AND d."acceptsOnlineBooking" AND d."archivedAt" IS NULL)
$fn$;

CREATE FUNCTION portal_booking_doctors()
RETURNS TABLE (id uuid, "fullName" text, specialty text, "slotMinutes" int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT d.id, u."fullName", d.specialty, d."defaultSlotMinutes" FROM "DoctorProfile" d
    JOIN "Membership" m ON m.id = d."membershipId" AND m."tenantId" = d."tenantId"
    JOIN "User" u ON u.id = m."userId"
   WHERE d."tenantId" = portal_current_tenant() AND portal_bookable_doctor(d.id)
   ORDER BY u."fullName"
$fn$;

CREATE FUNCTION portal_booking_rules()
RETURNS TABLE (days int, "leadMinutes" int, "maxActive" int, timezone text, "activeCount" int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(p."onlineBookingDays", 30), coalesce(p."onlineBookingLeadMinutes", 120), coalesce(p."onlineBookingMaxActive", 3), t.timezone,
         (SELECT count(*)::int FROM "Appointment" a WHERE a."patientId" = portal_current_patient() AND a.source = 'PORTAL'
            AND a.status = 'BOOKED' AND a."startsAt" > (now() AT TIME ZONE 'UTC'))
    FROM "Tenant" t LEFT JOIN "ClinicPolicy" p ON p."tenantId" = t.id
   WHERE t.id = portal_current_tenant()
$fn$;

CREATE FUNCTION portal_booking_blocks(p_doctor uuid)
RETURNS TABLE (weekday int, "startMinute" int, "endMinute" int, "branchId" uuid, "roomId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT w.weekday, w."startMinute", w."endMinute", w."branchId", w."roomId" FROM "WorkSchedule" w
   WHERE w."doctorProfileId" = p_doctor AND portal_bookable_doctor(p_doctor)
$fn$;

-- Days off only as dates (the reason, e.g. sick leave, is never exposed).
CREATE FUNCTION portal_booking_absences(p_doctor uuid, p_from date, p_to date) RETURNS SETOF date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT e.date FROM "ScheduleException" e
   WHERE e."doctorProfileId" = p_doctor AND portal_bookable_doctor(p_doctor) AND e.date BETWEEN p_from AND p_to AND p_to - p_from <= 190
$fn$;

CREATE FUNCTION portal_booking_busy(p_doctor uuid, p_from timestamp, p_to timestamp)
RETURNS TABLE ("startsAt" timestamp(3), "endsAt" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a."startsAt", a."endsAt" FROM "Appointment" a
   WHERE a."doctorProfileId" = p_doctor AND portal_bookable_doctor(p_doctor)
     AND a.status NOT IN ('CANCELLED', 'NO_SHOW') AND a.source <> 'WALK_IN'
     AND a."startsAt" < p_to AND a."endsAt" > p_from AND p_to - p_from <= interval '190 days'
$fn$;

-- Books one slot for the signed-in patient. Returns 'ok' or an error code; a
-- concurrent booking of the same time fails on the exclusion constraint (23P01).
CREATE FUNCTION portal_book(p_id uuid, p_doctor uuid, p_starts timestamp) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_patient uuid := portal_current_patient();
  v_tenant  uuid := portal_current_tenant();
  v_now     timestamp(3) := now() AT TIME ZONE 'UTC';
  v_tz text; v_days int; v_lead int; v_max int; v_active int; v_dur int;
  v_local timestamp; v_minute int; v_block record;
BEGIN
  IF v_patient IS NULL OR v_tenant IS NULL THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Patient" WHERE id = v_patient AND status = 'ACTIVE') THEN RETURN 'forbidden'; END IF;
  IF NOT portal_bookable_doctor(p_doctor) THEN RETURN 'doctor_unavailable'; END IF;
  SELECT r.days, r."leadMinutes", r."maxActive", r.timezone, r."activeCount" INTO v_days, v_lead, v_max, v_tz, v_active FROM portal_booking_rules() r;
  IF p_starts < v_now + make_interval(mins => v_lead) THEN RETURN 'too_soon'; END IF;
  IF p_starts > v_now + make_interval(days => v_days) THEN RETURN 'too_far'; END IF;
  IF v_active >= v_max THEN RETURN 'too_many'; END IF;
  SELECT "defaultSlotMinutes" INTO v_dur FROM "DoctorProfile" WHERE id = p_doctor;
  v_local := (p_starts AT TIME ZONE 'UTC') AT TIME ZONE v_tz;
  IF date_part('second', v_local) <> 0 THEN RETURN 'outside_schedule'; END IF;
  v_minute := date_part('hour', v_local)::int * 60 + date_part('minute', v_local)::int;
  IF EXISTS (SELECT 1 FROM "ScheduleException" e WHERE e."doctorProfileId" = p_doctor AND e.date = v_local::date) THEN RETURN 'outside_schedule'; END IF;
  SELECT w."branchId", w."roomId" INTO v_block FROM "WorkSchedule" w
   WHERE w."doctorProfileId" = p_doctor AND w.weekday = date_part('isodow', v_local)::int
     AND w."startMinute" <= v_minute AND v_minute + v_dur <= w."endMinute" AND (v_minute - w."startMinute") % v_dur = 0
   LIMIT 1;
  IF NOT FOUND THEN RETURN 'outside_schedule'; END IF;
  INSERT INTO "Appointment" (id, "tenantId", "patientId", "doctorProfileId", "branchId", "roomId", "startsAt", "endsAt", status, source, "createdById", "updatedAt")
  VALUES (p_id, v_tenant, v_patient, p_doctor, v_block."branchId", v_block."roomId", p_starts, p_starts + make_interval(mins => v_dur), 'BOOKED', 'PORTAL', NULL, v_now);
  RETURN 'ok';
END $fn$;

REVOKE ALL ON FUNCTION portal_telegram_bot(), portal_bookable_doctor(uuid), portal_booking_doctors(), portal_booking_rules(),
  portal_booking_blocks(uuid), portal_booking_absences(uuid, date, date), portal_booking_busy(uuid, timestamp, timestamp),
  portal_book(uuid, uuid, timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_telegram_bot(), portal_bookable_doctor(uuid), portal_booking_doctors(), portal_booking_rules(),
  portal_booking_blocks(uuid), portal_booking_absences(uuid, date, date), portal_booking_busy(uuid, timestamp, timestamp),
  portal_book(uuid, uuid, timestamp) TO itopmed_portal;
