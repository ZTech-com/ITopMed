import "server-only";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { PlatformPrincipal, RequestMeta } from "../auth/platform-auth";
import { platformCan } from "../authz/platform";
import { withAppContext, withPlatform } from "../db";
import { env, telegramTransport } from "../env";
import { DomainError } from "../errors";
import { api, botTokenSchema, ctxKey, miniAppUrl } from "../notifications/telegram";
import { decryptField, encryptField, hashIp } from "../security/crypto";
import { assertTenantInScope } from "../tenancy/provisioning";
import type { TelegramConfig } from "../auth/telegram-oidc";

/**
 * Each clinic has its OWN Telegram bot (created by ITop Med with @BotFather and
 * connected by the SuperAdmin in the console). That one bot does everything for
 * the clinic: patient notifications, the Mini App (/tg/<slug>) and website
 * sign-in (/login/<slug>, Login Widget client secret). The platform role never
 * reads the token back: it hands it over encrypted (platform_set_clinic_bot).
 */

const loginKey = (tenantId: string) => `telegram-login:${tenantId}`;

export interface ClinicBot {
  tenantId: string;
  slug: string;
  name: string;
  username: string;
  token: string;
  /** Login Widget client secret; null = no "Sign in with Telegram" for this clinic. */
  loginSecret: string | null;
}

const SLUG = /^[a-z0-9-]{3,48}$/;

/** The clinic and its enabled bot by workspace address (before anyone is signed in). */
export async function clinicBot(slug: string): Promise<ClinicBot | null> {
  if (!SLUG.test(slug)) return null;
  const rows = await withAppContext({}, (tx) =>
    tx.$queryRaw<{ tenantId: string; slug: string; name: string; username: string; tokenEnc: string; loginSecretEnc: string | null }[]>`
      SELECT "tenantId", slug, name, username, "tokenEnc", "loginSecretEnc" FROM app_clinic_bot(${slug})`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    tenantId: r.tenantId,
    slug: r.slug,
    name: r.name,
    username: r.username,
    token: decryptField(r.tokenEnc, ctxKey(r.tenantId)),
    loginSecret: r.loginSecretEnc ? decryptField(r.loginSecretEnc, loginKey(r.tenantId)) : null,
  };
}

/** Clinic name for /login/<slug>, with or without a bot. */
export async function clinicPublic(slug: string): Promise<{ tenantId: string; slug: string; name: string } | null> {
  if (!SLUG.test(slug)) return null;
  const rows = await withAppContext({}, (tx) => tx.$queryRaw<{ tenantId: string; slug: string; name: string }[]>`SELECT "tenantId", slug, name FROM app_clinic_public(${slug})`);
  return rows[0] ?? null;
}

/** OpenID Connect client of the clinic's bot (Client ID = the bot's id). */
export function clinicLoginConfig(bot: ClinicBot): TelegramConfig | null {
  if (!bot.loginSecret) return null;
  return { clientId: bot.token.split(":")[0]!, clientSecret: bot.loginSecret, redirectUri: new URL("/auth/telegram/callback", env().APP_URL).toString() };
}

// ───────────── Console: connect / disconnect ─────────────

export const connectBotSchema = z.object({
  token: botTokenSchema,
  loginSecret: z.union([z.literal("").transform(() => undefined), z.string().trim().min(8, "validation.telegramSecret").max(256)]).optional(),
});

function authorize(actor: PlatformPrincipal) {
  if (!platformCan(actor.user.role, "tenants.manage")) throw new DomainError("errors.forbidden");
}

/**
 * Connects (or replaces) a clinic's bot: checks the token with Telegram, then
 * points the bot's menu button at the clinic's Mini App and sets /start. The
 * bot keeps receiving messages by polling (the worker), so any webhook is removed.
 */
export async function connectClinicBot(actor: PlatformPrincipal, tenantId: string, raw: unknown, meta: RequestMeta): Promise<{ username: string }> {
  authorize(actor);
  const input = connectBotSchema.parse(raw);
  const tenant = await withPlatform(async (tx) => {
    await assertTenantInScope(tx, actor, tenantId);
    return tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true } });
  });
  if (!tenant) throw new DomainError("errors.notFound");

  let username = "itopmed_simulated_bot";
  if (telegramTransport() === "api") {
    try {
      username = (await api<{ username: string }>(input.token, "getMe", {})).username;
    } catch {
      throw new DomainError("errors.telegramTokenInvalid");
    }
    await api(input.token, "deleteWebhook", { drop_pending_updates: false }).catch(() => undefined);
    await api(input.token, "setMyCommands", { commands: [{ command: "start", description: "ITop Med" }] }).catch(() => undefined);
    await api(input.token, "setChatMenuButton", { menu_button: { type: "web_app", text: "ITop Med", web_app: { url: miniAppUrl(tenant.slug) } } }).catch(() => undefined);
  }
  await withPlatform(async (tx) => {
    const tokenEnc = encryptField(input.token, ctxKey(tenant.id));
    const secretEnc = input.loginSecret ? encryptField(input.loginSecret, loginKey(tenant.id)) : null;
    await tx.$executeRaw`SELECT platform_set_clinic_bot(${tenant.id}::uuid, ${username}, ${tokenEnc}, ${secretEnc})`;
    await recordAudit(tx, {
      tenantId: tenant.id,
      actorType: "PLATFORM_USER",
      actorId: actor.user.id,
      action: "telegram.bot_connected",
      entityType: "TelegramBot",
      entityId: tenant.id,
      ipHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
      metadata: { username, login: Boolean(secretEnc) },
    });
  });
  return { username };
}

export async function disconnectClinicBot(actor: PlatformPrincipal, tenantId: string, meta: RequestMeta) {
  authorize(actor);
  await withPlatform(async (tx) => {
    await assertTenantInScope(tx, actor, tenantId);
    await tx.$executeRaw`SELECT platform_clear_clinic_bot(${tenantId}::uuid)`;
    await recordAudit(tx, { tenantId, actorType: "PLATFORM_USER", actorId: actor.user.id, action: "telegram.bot_disconnected", entityType: "TelegramBot", entityId: tenantId, ipHash: hashIp(meta.ip), userAgent: meta.userAgent });
  });
}

export async function clinicBotStatus(actor: PlatformPrincipal, tenantId: string) {
  return withPlatform(async (tx) => {
    await assertTenantInScope(tx, actor, tenantId);
    const rows = await tx.$queryRaw<{ username: string; enabled: boolean; connectedAt: Date; loginEnabled: boolean }[]>`
      SELECT username, enabled, "connectedAt", "loginEnabled" FROM platform_clinic_bot_status(${tenantId}::uuid)`;
    return rows[0] ?? null;
  });
}
