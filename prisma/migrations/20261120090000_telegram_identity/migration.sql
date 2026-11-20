-- ============================================================================
-- One Telegram identity everywhere: the Telegram USER ID (the same number the
-- website login (OIDC `id` claim) and the bot's Mini App (initData) report).
-- Replaces the OIDC `sub` stored by username_telegram_login.
-- Patients are recognised by the phone number Telegram verified for them.
-- ============================================================================

-- ---------- Staff: Telegram user id instead of the OIDC subject ---------------
DROP FUNCTION IF EXISTS app_auth_lookup_telegram(text);
ALTER TABLE "User" DROP COLUMN "telegramSub";
ALTER TABLE "User" ADD COLUMN "telegramId" BIGINT;
ALTER TABLE "User" ADD CONSTRAINT "User_telegramId_chk" CHECK ("telegramId" IS NULL OR "telegramId" > 0);
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

ALTER TABLE "PlatformUser" DROP COLUMN "telegramSub";
ALTER TABLE "PlatformUser" ADD COLUMN "telegramId" BIGINT;
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_telegramId_chk" CHECK ("telegramId" IS NULL OR "telegramId" > 0);
CREATE UNIQUE INDEX "PlatformUser_telegramId_key" ON "PlatformUser"("telegramId");

-- By the verified Telegram user id (checked by the application first).
CREATE FUNCTION app_auth_lookup_telegram(p_tg bigint)
RETURNS TABLE (id uuid, status "AccountStatus", "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$fn$ SELECT u.id, u.status, u."lockedUntil" FROM "User" u WHERE u."telegramId" = p_tg $fn$;
REVOKE ALL ON FUNCTION app_auth_lookup_telegram(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_lookup_telegram(bigint) TO itopmed_app;

-- Administrator's new password also unlinks Telegram (same guardrails as before).
CREATE OR REPLACE FUNCTION app_set_member_password(p_user uuid, p_hash text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_actor  uuid := app_current_user();
  v_now    timestamp(3) := now() AT TIME ZONE 'UTC';
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL OR p_user IS NULL OR p_user = v_actor THEN RETURN 'forbidden'; END IF;
  IF p_hash IS NULL OR p_hash NOT LIKE '$argon2id$%' THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Membership" m
      JOIN "MembershipRole" mr ON mr."membershipId" = m.id
      JOIN "RolePermission" rp ON rp."roleId" = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = v_actor AND m.status = 'ACTIVE' AND rp.permission = 'staff.manage'
  ) THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Membership" WHERE "tenantId" = v_tenant AND "userId" = p_user AND status <> 'REMOVED') THEN
    RETURN 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Membership" m JOIN "MembershipRole" mr ON mr."membershipId" = m.id JOIN "Role" r ON r.id = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = p_user AND r.key = 'clinic_owner'
  ) AND NOT EXISTS (
    SELECT 1 FROM "Membership" m JOIN "MembershipRole" mr ON mr."membershipId" = m.id JOIN "Role" r ON r.id = mr."roleId"
     WHERE m."tenantId" = v_tenant AND m."userId" = v_actor AND m.status = 'ACTIVE' AND r.key = 'clinic_owner'
  ) THEN RETURN 'owner_only'; END IF;
  IF EXISTS (SELECT 1 FROM "Membership" WHERE "userId" = p_user AND "tenantId" <> v_tenant AND status <> 'REMOVED') THEN
    RETURN 'other_clinics';
  END IF;
  UPDATE "User" SET "passwordHash" = p_hash, "failedLoginCount" = 0, "lockedUntil" = NULL,
         "telegramId" = NULL, "telegramLinkedAt" = NULL, "updatedAt" = v_now
   WHERE id = p_user;
  UPDATE "Session" SET "revokedAt" = v_now WHERE "userId" = p_user AND "revokedAt" IS NULL;
  RETURN 'ok';
END $fn$;

-- ---------- Patients: phone number verified by Telegram -----------------------
-- Written only when a person shares THEIR OWN contact with the central bot
-- (contact.user_id = sender). No runtime role reads or writes the table
-- directly; the two functions below are the only way in.
CREATE TABLE "TelegramContact" (
    "telegramId" BIGINT NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "TelegramContact_pkey" PRIMARY KEY ("telegramId"),
    CONSTRAINT "TelegramContact_phone_chk" CHECK ("phone" ~ '^\+[0-9]{9,15}$')
);
CREATE INDEX "TelegramContact_phone_idx" ON "TelegramContact"("phone");
REVOKE ALL ON "TelegramContact" FROM PUBLIC;
ALTER TABLE "TelegramContact" ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies and no grants: access only through the SECURITY DEFINER functions.

CREATE FUNCTION tg_contact_save(p_tg bigint, p_phone text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO "TelegramContact" ("telegramId", phone, "verifiedAt") VALUES (p_tg, p_phone, now() AT TIME ZONE 'UTC')
  ON CONFLICT ("telegramId") DO UPDATE SET phone = EXCLUDED.phone, "verifiedAt" = EXCLUDED."verifiedAt"
$fn$;
REVOKE ALL ON FUNCTION tg_contact_save(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tg_contact_save(bigint, text) TO itopmed_portal;

-- Has this Telegram user shared their phone, and which ACTIVE portal accounts
-- (usable clinic, portal module on) use that phone as their login?
-- Returns only what is needed to offer a choice: account, clinic and its name.
CREATE FUNCTION tg_contact_known(p_tg bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "TelegramContact" WHERE "telegramId" = p_tg)
$fn$;
REVOKE ALL ON FUNCTION tg_contact_known(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tg_contact_known(bigint) TO itopmed_portal;

CREATE FUNCTION portal_telegram_accounts(p_tg bigint)
RETURNS TABLE (id uuid, "tenantId" uuid, slug text, name text, "lockedUntil" timestamp(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a.id, a."tenantId", t.slug, t.name, a."lockedUntil"
    FROM "TelegramContact" c
    JOIN "PatientAccount" a ON a.login = c.phone AND a.status = 'ACTIVE'
    JOIN "Tenant" t ON t.id = a."tenantId" AND t.status IN ('TRIAL', 'ACTIVE')
   WHERE c."telegramId" = p_tg AND portal_module_enabled(t.id, 'patient_portal')
   ORDER BY t.name
$fn$;
REVOKE ALL ON FUNCTION portal_telegram_accounts(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_telegram_accounts(bigint) TO itopmed_portal;
