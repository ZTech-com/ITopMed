-- ============================================================================
-- Each clinic's own Telegram bot does everything for that clinic: notifications
-- (as before), the Mini App (/tg/<slug>) and website sign-in (/login/<slug>).
-- The ITop Med SuperAdmin connects it from the console. The platform role still
-- never READS a bot token: it can only hand one over (already encrypted by the
-- application) or remove it, through the functions below.
-- ============================================================================

ALTER TABLE "TelegramBot" ADD COLUMN "loginSecretEnc" TEXT;

-- Console: connect / replace the clinic's bot. tokenEnc and loginSecretEnc are
-- AES-GCM ciphertexts made by the application (context-bound to the clinic).
CREATE FUNCTION platform_set_clinic_bot(p_tenant uuid, p_username text, p_token_enc text, p_login_secret_enc text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO "TelegramBot" ("tenantId", "tokenEnc", username, enabled, "updateOffset", "connectedAt", "updatedById", "updatedAt", "loginSecretEnc")
  VALUES (p_tenant, p_token_enc, p_username, true, 0, now() AT TIME ZONE 'UTC', NULL, now() AT TIME ZONE 'UTC', p_login_secret_enc)
  ON CONFLICT ("tenantId") DO UPDATE SET
    "tokenEnc" = EXCLUDED."tokenEnc", username = EXCLUDED.username, enabled = true, "updateOffset" = 0,
    "connectedAt" = EXCLUDED."connectedAt", "updatedAt" = EXCLUDED."updatedAt", "loginSecretEnc" = EXCLUDED."loginSecretEnc"
$fn$;
REVOKE ALL ON FUNCTION platform_set_clinic_bot(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_set_clinic_bot(uuid, text, text, text) TO itopmed_platform;

CREATE FUNCTION platform_clear_clinic_bot(p_tenant uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  DELETE FROM "TelegramBot" WHERE "tenantId" = p_tenant
$fn$;
REVOKE ALL ON FUNCTION platform_clear_clinic_bot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_clear_clinic_bot(uuid) TO itopmed_platform;

-- Console status: no token, no secret, no chats.
CREATE FUNCTION platform_clinic_bot_status(p_tenant uuid)
RETURNS TABLE (username text, enabled boolean, "connectedAt" timestamp(3), "loginEnabled" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT b.username, b.enabled, b."connectedAt", b."loginSecretEnc" IS NOT NULL FROM "TelegramBot" b WHERE b."tenantId" = p_tenant
$fn$;
REVOKE ALL ON FUNCTION platform_clinic_bot_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_clinic_bot_status(uuid) TO itopmed_platform;

-- Before anyone is signed in (/login/<slug>, /tg/<slug>): the clinic and its
-- enabled bot by workspace address. Usable clinics only.
CREATE FUNCTION app_clinic_bot(p_slug text)
RETURNS TABLE ("tenantId" uuid, slug text, name text, username text, "tokenEnc" text, "loginSecretEnc" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT t.id, t.slug, t.name, b.username, b."tokenEnc", b."loginSecretEnc"
    FROM "Tenant" t JOIN "TelegramBot" b ON b."tenantId" = t.id AND b.enabled
   WHERE t.slug = p_slug AND t.status IN ('TRIAL', 'ACTIVE')
$fn$;
REVOKE ALL ON FUNCTION app_clinic_bot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_clinic_bot(text) TO itopmed_app;

-- Clinic address and name for /login/<slug> even without a bot.
CREATE FUNCTION app_clinic_public(p_slug text)
RETURNS TABLE ("tenantId" uuid, slug text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT t.id, t.slug, t.name FROM "Tenant" t WHERE t.slug = p_slug AND t.status IN ('TRIAL', 'ACTIVE')
$fn$;
REVOKE ALL ON FUNCTION app_clinic_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_clinic_public(text) TO itopmed_app;

-- Is this Telegram user an ACTIVE member of this clinic (staff sign-in via that clinic's bot)?
CREATE FUNCTION app_telegram_member(p_tg bigint, p_tenant uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT u.id FROM "User" u
    JOIN "Membership" m ON m."userId" = u.id AND m."tenantId" = p_tenant AND m.status = 'ACTIVE'
   WHERE u."telegramId" = p_tg AND u.status = 'ACTIVE'
$fn$;
REVOKE ALL ON FUNCTION app_telegram_member(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_telegram_member(bigint, uuid) TO itopmed_app;
