import "server-only";
import { DomainError } from "../errors";
import { telegramLogin } from "../env";
import { logger } from "../logger";
import { hashIp, randomToken } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { withAppContext } from "../db";
import { clinicBot, clinicLoginConfig } from "../telegram/clinic-bot";
import { linkClinicTelegram, loginClinicWithTelegram, resolveClinic, validateClinicSession } from "./clinic-auth";
import { homeForRoles } from "./landing";
import { linkPlatformTelegram, loginPlatformWithTelegram, type RequestMeta } from "./platform-auth";
import {
  FLOW_TTL_S,
  TelegramLoginError,
  authorizationUrl,
  exchangeCode,
  pkcePair,
  sealFlow,
  telegramKeys,
  verifyIdToken,
  type Fetch,
  type FlowState,
  type KeyResolver,
  type TelegramLoginKind,
  type TelegramLoginMode,
} from "./telegram-oidc";

/** Where each outcome lands. Query values are fixed codes, never personal data. */
export function telegramReturnPath(kind: TelegramLoginKind, mode: TelegramLoginMode, code: string, next?: string, slug?: string): string {
  if (mode === "link") return `${kind === "admin" ? "/admin/security" : "/account/security"}?tg=${code}`;
  if (code === "ok") return kind === "admin" ? "/admin" : (next ?? "/clinics");
  const login = kind === "admin" ? "/admin/login" : slug ? `/login/${slug}` : "/login";
  return `${login}?tg=${code}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}

export type BeginResult = { ok: true; url: string; sealed: string } | { ok: false; code: "disabled" | "rate_limited" };

/** Clinic flows use that clinic's own bot; console flows the central bot. */
async function configFor(kind: TelegramLoginKind, slug: string | undefined) {
  if (kind === "clinic" && slug) {
    const bot = await clinicBot(slug);
    return bot ? clinicLoginConfig(bot) : null;
  }
  return kind === "admin" ? telegramLogin() : null;
}

/**
 * Starts a sign-in or link flow. `owner` is the signed-in account for link mode
 * (checked by the caller's guard). Clinic staff use their clinic's bot (`slug`).
 */
export async function beginTelegramFlow(
  kind: TelegramLoginKind,
  mode: TelegramLoginMode,
  owner: { userId: string; sessionId: string } | null,
  next: string | undefined,
  meta: RequestMeta,
  slug?: string,
): Promise<BeginResult> {
  const cfg = await configFor(kind, slug);
  if (!cfg) return { ok: false, code: "disabled" };
  if (mode === "link" && !owner) throw new DomainError("errors.forbidden");
  if (!(await rateLimit(`tgstart:${hashIp(meta.ip) ?? "noip"}`, 30, 15 * 60_000))) return { ok: false, code: "rate_limited" };
  const { verifier, challenge } = pkcePair();
  const flow: FlowState = {
    state: randomToken(),
    verifier,
    kind,
    mode,
    ...(owner ? { userId: owner.userId, sessionId: owner.sessionId } : {}),
    ...(next ? { next } : {}),
    ...(kind === "clinic" && slug ? { slug } : {}),
    exp: Math.floor(Date.now() / 1000) + FLOW_TTL_S,
  };
  return { ok: true, url: authorizationUrl(cfg, flow.state, challenge), sealed: sealFlow(flow) };
}

export type FinishResult =
  | { outcome: "signed_in"; kind: TelegramLoginKind; token: string; locale: string | null; next?: string }
  | { outcome: "linked"; kind: TelegramLoginKind }
  | { outcome: "error"; kind: TelegramLoginKind; mode: TelegramLoginMode; code: "not_linked" | "locked" | "rate_limited" | "taken" | "failed" | "disabled"; next?: string; slug?: string };

/**
 * Completes a flow whose state cookie was already opened and matched (see
 * openFlow): exchanges the code, verifies the id_token, then signs in or links.
 */
export async function finishTelegramFlow(
  flow: FlowState,
  code: string,
  meta: RequestMeta,
  deps: { fetch?: Fetch; keys?: KeyResolver } = {},
): Promise<FinishResult> {
  const fail = (c: Extract<FinishResult, { outcome: "error" }>["code"]): FinishResult => ({ outcome: "error", kind: flow.kind, mode: flow.mode, code: c, next: flow.next, slug: flow.slug });
  const cfg = await configFor(flow.kind, flow.slug);
  if (!cfg) return fail("disabled");
  if (!/^[\w.~-]{1,512}$/.test(code)) return fail("failed");

  let tgId: bigint;
  try {
    const idToken = await exchangeCode(cfg, code, flow.verifier, deps.fetch);
    ({ id: tgId } = await verifyIdToken(idToken, cfg.clientId, deps.keys ?? telegramKeys(deps.fetch)));
  } catch (e) {
    // Reason codes only: no token, code or claim ever reaches the log.
    logger.warn("telegram.login.verify_failed", { reason: e instanceof TelegramLoginError ? e.reason : "network" });
    return fail("failed");
  }

  if (flow.mode === "link") {
    if (!flow.userId || !flow.sessionId) return fail("failed");
    try {
      if (flow.kind === "admin") await linkPlatformTelegram(flow.userId, flow.sessionId, tgId, meta);
      else await linkClinicTelegram(flow.userId, flow.sessionId, tgId, meta);
    } catch (e) {
      if (e instanceof DomainError && e.code === "errors.telegramTaken") return fail("taken");
      return fail("failed");
    }
    return { outcome: "linked", kind: flow.kind };
  }

  if (flow.kind === "admin") {
    const r = await loginPlatformWithTelegram(tgId, meta);
    if (!r.ok) return fail(r.reason);
    return { outcome: "signed_in", kind: "admin", token: r.token, locale: r.locale };
  }
  // A clinic's bot signs in that clinic's staff only.
  const bot = flow.slug ? await clinicBot(flow.slug) : null;
  if (!bot) return fail("disabled");
  const member = await withAppContext({}, (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app_telegram_member(${tgId}::bigint, ${bot.tenantId}::uuid) AS id`);
  if (!member[0]?.id) return fail("not_linked");
  const r = await loginClinicWithTelegram(tgId, meta);
  if (!r.ok) return fail(r.reason);
  let next = flow.next;
  if (!next) {
    const p = await validateClinicSession(r.token);
    const ctx = p ? await resolveClinic(p, bot.slug) : null;
    next = ctx ? homeForRoles(bot.slug, ctx.roleKeys) : "/clinics";
  }
  return { outcome: "signed_in", kind: "clinic", token: r.token, locale: r.locale, next };
}
