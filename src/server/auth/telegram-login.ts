import "server-only";
import { DomainError } from "../errors";
import { env, telegramTransport } from "../env";
import { logger } from "../logger";
import { api } from "../notifications/telegram";
import { hashIp } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { withAppContext } from "../db";
import { clinicBot } from "../telegram/clinic-bot";
import { linkClinicTelegram, loginClinicWithTelegram, resolveClinic, validateClinicSession } from "./clinic-auth";
import { homeForRoles } from "./landing";
import { linkPlatformTelegram, loginPlatformWithTelegram, type RequestMeta } from "./platform-auth";
import { verifyWidgetAuth, type FlowState, type TelegramLoginKind, type TelegramLoginMode } from "./telegram-auth";

/** Where each outcome lands. Query values are fixed codes, never personal data. */
export function telegramReturnPath(kind: TelegramLoginKind, mode: TelegramLoginMode, code: string, next?: string, slug?: string): string {
  if (mode === "link") return `${kind === "admin" ? "/admin/security" : "/account/security"}?tg=${code}`;
  if (code === "ok") return kind === "admin" ? "/admin" : (next ?? "/clinics");
  const login = kind === "admin" ? "/admin/login" : slug ? `/login/${slug}` : "/login";
  return `${login}?tg=${code}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}

// ───────────── Which bot ─────────────
//
// Telegram gives a bot ONE domain (@BotFather > /setdomain):
//  - the ITop Med bot (TELEGRAM_BOT_TOKEN): the founder's console only
//    (domain = ADMIN_URL's host, or APP_URL's without one);
//  - each clinic's own bot: /login/<slug> and its Mini App /tg/<slug>, that
//    clinic's staff and patients (domain = APP_URL's host).
// /login itself has no Telegram button: it asks for the clinic's address and
// opens /login/<slug>.

const usernames = new Map<string, string>();

/** A bot's @username (getMe, remembered per token). */
async function botUsername(token: string): Promise<string | null> {
  const known = usernames.get(token);
  if (known) return known;
  try {
    const me = await api<{ username?: string }>(token, "getMe", {});
    if (!me.username) return null;
    usernames.set(token, me.username);
    return me.username;
  } catch {
    logger.warn("telegram.login.getme_failed");
    return null;
  }
}

/** Token of the bot that signs a flow: the clinic's own bot, or the ITop Med bot for the console. */
async function botToken(kind: TelegramLoginKind, slug: string | undefined): Promise<string | null> {
  if (kind === "admin") return env().TELEGRAM_BOT_TOKEN ?? null;
  return slug ? ((await clinicBot(slug))?.token ?? null) : null;
}

/**
 * The bot whose Login Widget a page shows, or null (then login + password only).
 * The widget works only with the real Bot API and on the domain set for that bot
 * in @BotFather (/setdomain), so simulated set-ups never show it.
 */
export async function widgetBot(kind: TelegramLoginKind, slug?: string | null): Promise<{ username: string } | null> {
  // A clinic's local installation has no internet domain to give @BotFather: login + password there.
  if (telegramTransport() !== "api" || env().LOCAL_MODE === "1") return null;
  if (kind === "clinic") {
    const bot = slug ? await clinicBot(slug) : null;
    return bot ? { username: bot.username } : null;
  }
  const token = env().TELEGRAM_BOT_TOKEN;
  const username = token ? await botUsername(token) : null;
  return username ? { username } : null;
}

// ───────────── Completing a sign-in or link ─────────────

export type WidgetResult =
  | { outcome: "signed_in"; kind: TelegramLoginKind; token: string; locale: string | null; next?: string }
  | { outcome: "linked"; kind: TelegramLoginKind }
  | { outcome: "error"; kind: TelegramLoginKind; mode: TelegramLoginMode; code: "not_linked" | "locked" | "rate_limited" | "taken" | "failed" | "disabled"; next?: string; slug?: string };

export interface WidgetRequest {
  kind: TelegramLoginKind;
  mode: TelegramLoginMode;
  /** Clinic whose bot signed the fields (clinic flows). */
  slug?: string;
  next?: string;
  /** Telegram's signed fields from the callback query. */
  fields: Record<string, string>;
  /** Link mode: the opened flow cookie (who is linking). */
  flow?: FlowState | null;
}

/**
 * Checks the widget's fields with the right bot's token, then signs the person in
 * or links the Telegram account to the signed-in account of the flow.
 * Every signed answer is accepted once (replays are refused).
 */
export async function completeTelegramWidget(req: WidgetRequest, meta: RequestMeta): Promise<WidgetResult> {
  const slug = req.kind === "clinic" ? (req.flow?.slug ?? req.slug) : undefined;
  const fail = (c: Extract<WidgetResult, { outcome: "error" }>["code"]): WidgetResult => ({ outcome: "error", kind: req.kind, mode: req.mode, code: c, next: req.next, slug });
  if (!(await rateLimit(`tgwidget:${hashIp(meta.ip) ?? "noip"}`, 30, 15 * 60_000))) return fail("rate_limited");

  const token = await botToken(req.kind, slug);
  if (!token) return fail("disabled");
  const tgId = verifyWidgetAuth(req.fields, token);
  if (!tgId) {
    logger.warn("telegram.login.verify_failed");
    return fail("failed");
  }
  if (!(await rateLimit(`tgwidget-once:${req.fields.hash}`, 1, 30 * 60_000))) return fail("failed");

  if (req.mode === "link") {
    const flow = req.flow;
    if (!flow || flow.kind !== req.kind) return fail("failed");
    try {
      if (flow.kind === "admin") await linkPlatformTelegram(flow.userId, flow.sessionId, tgId, meta);
      else await linkClinicTelegram(flow.userId, flow.sessionId, tgId, meta);
    } catch (e) {
      if (e instanceof DomainError && e.code === "errors.telegramTaken") return fail("taken");
      return fail("failed");
    }
    return { outcome: "linked", kind: req.kind };
  }

  if (req.kind === "admin") {
    const r = await loginPlatformWithTelegram(tgId, meta);
    if (!r.ok) return fail(r.reason);
    return { outcome: "signed_in", kind: "admin", token: r.token, locale: r.locale };
  }
  // A clinic's bot signs in that clinic's staff only.
  const bot = slug ? await clinicBot(slug) : null;
  if (!bot) return fail("disabled");
  const member = await withAppContext({}, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_telegram_member(${tgId}::bigint, ${bot.tenantId}::uuid) AS id`);
  if (!member[0]?.id) return fail("not_linked");
  const r = await loginClinicWithTelegram(tgId, meta);
  if (!r.ok) return fail(r.reason);
  let next = req.next;
  if (!next) {
    const p = await validateClinicSession(r.token);
    const ctx = p ? await resolveClinic(p, bot.slug) : null;
    next = ctx ? homeForRoles(bot.slug, ctx.roleKeys) : "/clinics";
  }
  return { outcome: "signed_in", kind: "clinic", token: r.token, locale: r.locale, next };
}

/** For tests only. */
export function resetBotUsernames() {
  usernames.clear();
}

/** Can this installation offer Telegram sign-in at all (real Bot API, internet domain)? */
export function telegramPossible(): boolean {
  return telegramTransport() === "api" && env().LOCAL_MODE !== "1";
}

/**
 * The clinic's address as people type it on /login: "shifo", "/login/shifo",
 * "https://itopmed.itoppos.uz/login/shifo" or "…/c/shifo/desk" → "shifo".
 */
export function clinicSlugFromInput(raw: string | undefined): string | null {
  if (!raw) return null;
  let path = raw.trim().toLowerCase().slice(0, 300);
  path = path.replace(/^[a-z]+:\/\//, "").replace(/[?#].*$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.includes("..")) return null;
  if (parts.length > 1 && parts[0]!.includes(".")) parts.shift();
  const at = parts.findIndex((x) => x === "login" || x === "c" || x === "tg" || x === "p");
  const slug = at >= 0 ? parts[at + 1] : parts[parts.length - 1];
  return slug && /^[a-z0-9-]{3,48}$/.test(slug) ? slug : null;
}
