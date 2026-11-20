import "server-only";
import { createHmac } from "node:crypto";
import { env } from "../env";
import { loginPatientWithTelegram, telegramPatientAccounts } from "../portal/auth";
import { platformDb, withAppContext } from "../db";
import { hashIp, safeEqual } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { loginClinicWithTelegram, validateClinicSession } from "./clinic-auth";
import { staffHome } from "./landing";
import { loginPlatformWithTelegram, type RequestMeta } from "./platform-auth";
import { parseTelegramId } from "./telegram-oidc";

/**
 * The central bot's Mini App (opened from the bot's button inside Telegram).
 * Telegram hands the page signed launch data (initData); its HMAC is checked
 * with the bot token (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * before the Telegram user id in it is trusted. Then:
 *   - linked clinic staff → their clinic, on the page for their role;
 *   - linked ITop Med staff → the console;
 *   - a patient whose Telegram-verified phone is a portal login → that portal;
 *   - more than one of these → the person chooses;
 *   - nobody → the patient page (share phone number / not registered yet).
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
  | { status: "error"; reason: "invalid" | "disabled" | "locked" | "rate_limited" };

async function candidates(tgId: bigint) {
  const [clinic, admin, patients] = await Promise.all([
    withAppContext({}, (tx) =>
      tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status::text AS status FROM app_auth_lookup_telegram(${tgId}::bigint)`,
    ).then((r) => (r[0]?.status === "ACTIVE" ? r[0] : null)),
    platformDb()
      .platformUser.findUnique({ where: { telegramId: tgId }, select: { id: true, status: true } })
      .then((u) => (u?.status === "ACTIVE" ? u : null)),
    telegramPatientAccounts(tgId),
  ]);
  return { clinic, admin, patients };
}

/** Resolves a Mini App launch. `choice` is one of the keys offered earlier (re-checked here). */
export async function resolveWebApp(initData: string, choice: string | null, meta: RequestMeta): Promise<WebAppResult> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return { status: "error", reason: "disabled" };
  if (!(await rateLimit(`tgapp:${hashIp(meta.ip) ?? "noip"}`, 60, 15 * 60_000))) return { status: "error", reason: "rate_limited" };
  const tgId = verifyInitData(initData, token);
  if (!tgId) return { status: "error", reason: "invalid" };

  const c = await candidates(tgId);
  const choices: Choice[] = [];
  if (c.clinic) choices.push({ key: "staff", kind: "staff", clinic: null });
  if (c.admin) choices.push({ key: "admin", kind: "admin", clinic: null });
  for (const a of c.patients.accounts) choices.push({ key: `patient:${a.id}`, kind: "patient", clinic: a.name });

  if (choices.length === 0) return { status: "patient", phoneKnown: c.patients.phoneKnown };
  const pick = choice ? choices.find((x) => x.key === choice) : choices.length === 1 ? choices[0] : undefined;
  if (!pick) return { status: "choose", choices };

  if (pick.kind === "staff") {
    const r = await loginClinicWithTelegram(tgId, meta);
    if (!r.ok) return { status: "error", reason: r.reason === "not_linked" ? "invalid" : r.reason };
    const p = await validateClinicSession(r.token);
    return { status: "signed_in", target: "clinic", token: r.token, locale: r.locale, go: p ? await staffHome(p) : "/clinics" };
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
