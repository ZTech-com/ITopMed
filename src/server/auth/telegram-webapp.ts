import "server-only";
import { createHmac } from "node:crypto";
import { env } from "../env";
import { loginPatientWithTelegram, telegramPatientAccounts } from "../portal/auth";
import { platformDb, withAppContext } from "../db";
import { hashIp, safeEqual } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { clinicBot } from "../telegram/clinic-bot";
import { loginClinicWithTelegram, resolveClinic, validateClinicSession } from "./clinic-auth";
import { homeForRoles } from "./landing";
import { loginPlatformWithTelegram, type RequestMeta } from "./platform-auth";
import { parseTelegramId } from "./telegram-auth";

/**
 * Mini Apps of the clinics' bots (/tg/<slug>) and of the central ITop Med bot (/tg).
 * Telegram hands the page signed launch data (initData); its HMAC is checked
 * with the bot token (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * before the Telegram user id in it is trusted. Then:
 *   - clinic bot: that clinic's linked staff → their role's page; its patient
 *     whose Telegram-verified phone is a portal login → the portal; both → the
 *     person chooses; nobody → the patient page (share phone / not registered);
 *   - central bot: linked ITop Med staff → the console.
 */

/** Launch data older than this is refused (Telegram re-signs it at every launch). */
const MAX_AGE_S = 24 * 60 * 60;

export function verifyInitData(initData: string, botToken: string, nowS = Math.floor(Date.now() / 1000)): bigint | null {
  if (!initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  if (!safeEqual(expected, hash)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate > nowS + 60 || nowS - authDate > MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id?: unknown; is_bot?: unknown } | null;
    if (!user || user.is_bot === true) return null;
    return parseTelegramId(user.id);
  } catch {
    return null;
  }
}

export interface Choice {
  /** "staff" | "admin" | "patient:<accountId>" */
  key: string;
  kind: "staff" | "admin" | "patient";
  /** Clinic name(s); null for the console. */
  clinic: string | null;
}

export type WebAppResult =
  | { status: "signed_in"; target: "clinic" | "admin" | "patient"; token: string; locale: string | null; go: string }
  | { status: "choose"; choices: Choice[] }
  | { status: "patient"; phoneKnown: boolean }
  | { status: "error"; reason: "invalid" | "disabled" | "locked" | "rate_limited" | "not_platform" };

/**
 * Resolves a Mini App launch.
 *  - `slug` given: the CLINIC's bot (/tg/<slug>). Only that clinic counts: its
 *    staff (active membership) land on their role's page, its patients in its
 *    portal; both → choose; nobody → patient page.
 *  - no slug: the central ITop Med bot, for platform staff only.
 * `choice` must be one of the keys offered earlier (re-checked here).
 */
export async function resolveWebApp(initData: string, choice: string | null, meta: RequestMeta, slug: string | null = null): Promise<WebAppResult> {
  if (!(await rateLimit(`tgapp:${hashIp(meta.ip) ?? "noip"}`, 60, 15 * 60_000))) return { status: "error", reason: "rate_limited" };
  const bot = slug ? await clinicBot(slug) : null;
  const token = slug ? bot?.token : env().TELEGRAM_BOT_TOKEN;
  if (!token) return { status: "error", reason: "disabled" };
  const tgId = verifyInitData(initData, token);
  if (!tgId) return { status: "error", reason: "invalid" };

  const choices: Choice[] = [];
  if (bot) {
    const member = await withAppContext({}, (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`SELECT app_telegram_member(${tgId}::bigint, ${bot.tenantId}::uuid) AS id`,
    );
    if (member[0]?.id) choices.push({ key: "staff", kind: "staff", clinic: bot.name });
    const patients = await telegramPatientAccounts(tgId);
    for (const a of patients.accounts.filter((x) => x.tenantId === bot.tenantId)) choices.push({ key: `patient:${a.id}`, kind: "patient", clinic: a.name });
    if (choices.length === 0) return { status: "patient", phoneKnown: patients.phoneKnown };
  } else {
    const admin = await platformDb().platformUser.findUnique({ where: { telegramId: tgId }, select: { status: true, role: true } });
    if (admin?.status === "ACTIVE" && admin.role === "SUPER_ADMIN") choices.push({ key: "admin", kind: "admin", clinic: null });
    if (choices.length === 0) return { status: "error", reason: "not_platform" };
  }

  const pick = choice ? choices.find((x) => x.key === choice) : choices.length === 1 ? choices[0] : undefined;
  if (!pick) return { status: "choose", choices };

  if (pick.kind === "staff" && bot) {
    const r = await loginClinicWithTelegram(tgId, meta);
    if (!r.ok) return { status: "error", reason: r.reason === "not_linked" ? "invalid" : r.reason };
    const p = await validateClinicSession(r.token);
    const ctx = p ? await resolveClinic(p, bot.slug) : null;
    return { status: "signed_in", target: "clinic", token: r.token, locale: r.locale, go: ctx ? homeForRoles(bot.slug, ctx.roleKeys) : "/clinics" };
  }
  if (pick.kind === "admin") {
    const r = await loginPlatformWithTelegram(tgId, meta);
    if (!r.ok) return { status: "error", reason: r.reason === "not_linked" ? "invalid" : r.reason };
    return { status: "signed_in", target: "admin", token: r.token, locale: r.locale, go: "/admin" };
  }
  const r = await loginPatientWithTelegram(tgId, pick.key.slice("patient:".length), meta);
  if (!r.ok) return { status: "error", reason: r.reason };
  return { status: "signed_in", target: "patient", token: r.token, locale: r.locale, go: `/p/${r.slug}` };
}
